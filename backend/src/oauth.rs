//! Single-owner authorization-code + PKCE server for the public MCP listener.
use axum::{
    extract::{DefaultBodyLimit, Form, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, SqlitePool};
use std::{
    env,
    sync::{Arc, Mutex},
};
use subtle::ConstantTimeEq;
use uuid::Uuid;

type Error = (StatusCode, Json<Value>);
type Result<T> = std::result::Result<T, Error>;
const PAGE_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const ACCESS_SECONDS: i64 = 3600;
const REFRESH_SECONDS: i64 = 30 * 86400;
const DEFAULT_REDIRECTS: &str =
    "https://chatgpt.com/connector_platform_oauth_redirect,https://claude.ai/api/mcp/auth_callback";

pub(super) struct OAuth {
    pool: SqlitePool,
    issuer: String,
    password_hash: String,
    redirects: Vec<String>,
    epoch: String,
    limits: Mutex<[(i64, u32); 4]>,
    login_slot: tokio::sync::Semaphore,
}

pub(super) fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn password_parts(value: &str) -> Option<(Vec<u8>, &str)> {
    let parts: Vec<&str> = value.split('$').collect();
    if parts.len() != 3
        || parts[0] != "scrypt"
        || parts[1].len() != 32
        || parts[2].len() != 64
        || !parts[1..]
            .iter()
            .all(|s| s.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return None;
    }
    let salt = (0..32)
        .step_by(2)
        .map(|i| u8::from_str_radix(&parts[1][i..i + 2], 16).ok())
        .collect::<Option<Vec<_>>>()?;
    Some((salt, parts[2]))
}
async fn verify_password(password: String, encoded: String) -> bool {
    if password.len() > 256 {
        return false;
    }
    tokio::task::spawn_blocking(move || {
        let Some((salt, expected)) = password_parts(&encoded) else {
            return false;
        };
        let mut key = [0u8; 32];
        let params = scrypt::Params::new(17, 8, 1, 32).expect("fixed scrypt parameters");
        if scrypt::scrypt(password.as_bytes(), &salt, &params, &mut key).is_err() {
            return false;
        }
        let actual = key.iter().map(|b| format!("{b:02x}")).collect::<String>();
        equal(&actual, &expected.to_lowercase())
    })
    .await
    .unwrap_or(false)
}
fn secret() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}
fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
fn error(code: &'static str) -> Error {
    (StatusCode::BAD_REQUEST, Json(json!({"error":code})))
}
fn database(error: sqlx::Error) -> Error {
    tracing::error!("OAuth storage failure: {error}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error":"server_error"})),
    )
}
fn equal(a: &str, b: &str) -> bool {
    bool::from(a.as_bytes().ct_eq(b.as_bytes()))
}
fn escaped(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

impl OAuth {
    pub(super) fn from_env(
        pool: SqlitePool,
    ) -> std::result::Result<Option<Arc<Self>>, &'static str> {
        let issuer = env::var("NEXTLEAF_OAUTH_ISSUER").unwrap_or_default();
        let password = env::var("NEXTLEAF_OAUTH_PASSWORD_HASH").unwrap_or_default();
        if issuer.is_empty() && password.is_empty() {
            return Ok(None);
        }
        Self::new(
            pool,
            &issuer,
            &password,
            &env::var("NEXTLEAF_OAUTH_REDIRECT_URIS").unwrap_or_else(|_| DEFAULT_REDIRECTS.into()),
        )
        .map(|s| Some(Arc::new(s)))
    }
    fn new(
        pool: SqlitePool,
        issuer: &str,
        password_hash: &str,
        redirects: &str,
    ) -> std::result::Result<Self, &'static str> {
        let url = reqwest::Url::parse(issuer)
            .map_err(|_| "NEXTLEAF_OAUTH_ISSUER must be an HTTPS origin")?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(
                "NEXTLEAF_OAUTH_ISSUER must be an HTTPS origin without credentials, query or path",
            );
        }
        if password_parts(password_hash).is_none() {
            return Err(
                "NEXTLEAF_OAUTH_PASSWORD_HASH must be generated with deploy/oauth_password.py",
            );
        }
        let redirects: Vec<String> = redirects
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect();
        if redirects.is_empty() || redirects.iter().any(|s| !valid_redirect(s)) {
            return Err("NEXTLEAF_OAUTH_REDIRECT_URIS must list exact HTTPS callbacks (HTTP only on loopback)");
        }
        let issuer = url.origin().ascii_serialization();
        let password_hash = password_hash.to_owned();
        let epoch = hash(&format!("{issuer}:{password_hash}"));
        Ok(Self {
            pool,
            issuer,
            password_hash,
            redirects,
            epoch,
            limits: Mutex::new([(0, 0); 4]),
            login_slot: tokio::sync::Semaphore::new(1),
        })
    }
    pub(super) fn challenge(&self) -> String {
        format!("Bearer resource_metadata=\"{}/.well-known/oauth-protected-resource\", scope=\"nextleaf\"", self.issuer)
    }
    pub(super) async fn accepts(&self, token: &str) -> Result<bool> {
        if token.len() != 64 {
            return Ok(false);
        }
        let valid: i64 = sqlx::query_scalar("SELECT count(*) FROM oauth_grants WHERE access_hash=? AND expires>? AND epoch=? AND (scope='nextleaf' OR scope='nextleaf offline_access')")
            .bind(hash(token)).bind(now()).bind(&self.epoch).fetch_one(&self.pool).await.map_err(database)?;
        Ok(valid == 1)
    }
    fn rate(&self, bucket: usize, limit: u32) -> Result<()> {
        let mut buckets = self.limits.lock().map_err(|_| error("server_error"))?;
        let (start, count) = &mut buckets[bucket];
        if now() - *start >= 60 {
            *start = now();
            *count = 0;
        }
        *count += 1;
        if *count > limit {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({"error":"temporarily_unavailable"})),
            ));
        }
        Ok(())
    }
    fn resource(&self, resource: Option<&str>) -> Result<()> {
        // Older MCP clients omit resource; every grant is still bound to this one issuer's /mcp.
        if resource.is_some_and(|r| r != format!("{}/mcp", self.issuer)) {
            return Err(error("invalid_target"));
        }
        Ok(())
    }
}

fn valid_redirect(value: &str) -> bool {
    reqwest::Url::parse(value).is_ok_and(|u| {
        (u.scheme() == "https"
            || (u.scheme() == "http"
                && matches!(u.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))))
            && u.host_str().is_some()
            && u.username().is_empty()
            && u.password().is_none()
            && u.fragment().is_none()
    })
}

pub(super) fn router(oauth: Arc<OAuth>) -> Router {
    Router::new()
        .route(
            "/.well-known/oauth-protected-resource",
            get(resource_metadata),
        )
        .route(
            "/.well-known/oauth-protected-resource/mcp",
            get(resource_metadata),
        )
        .route("/.well-known/oauth-authorization-server", get(metadata))
        .route("/oauth/register", post(register))
        .route("/oauth/authorize", get(authorize).post(consent))
        .route("/oauth/token", post(token))
        .route("/oauth/revoke", post(revoke))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(middleware::from_fn_with_state(oauth.clone(), protect))
        .with_state(oauth)
}

async fn protect(State(oauth): State<Arc<OAuth>>, request: Request, next: Next) -> Response {
    let expected = oauth.issuer.strip_prefix("https://").unwrap();
    let host_ok = request
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| h.eq_ignore_ascii_case(expected));
    let origin_ok = request
        .headers()
        .get(header::ORIGIN)
        .is_none_or(|v| v.to_str().ok() == Some(oauth.issuer.as_str()));
    let mut response = if host_ok && origin_ok {
        next.run(request).await
    } else {
        StatusCode::FORBIDDEN.into_response()
    };
    // no-referrer makes browser form POSTs send Origin: null, failing our origin check.
    for (key, value) in [
        (header::CACHE_CONTROL,"no-store"), (header::PRAGMA,"no-cache"),
        (header::REFERRER_POLICY,"same-origin"), (header::X_CONTENT_TYPE_OPTIONS,"nosniff"),
        (header::X_FRAME_OPTIONS,"DENY"),
    ] { response.headers_mut().insert(key, HeaderValue::from_static(value)); }
    response.headers_mut().entry(header::CONTENT_SECURITY_POLICY)
        .or_insert(HeaderValue::from_static(PAGE_CSP));
    response
}

async fn resource_metadata(State(oauth): State<Arc<OAuth>>) -> Json<Value> {
    Json(
        json!({"resource":format!("{}/mcp",oauth.issuer),"authorization_servers":[oauth.issuer],"scopes_supported":["nextleaf","offline_access"],"bearer_methods_supported":["header"]}),
    )
}
async fn metadata(State(oauth): State<Arc<OAuth>>) -> Json<Value> {
    Json(
        json!({"issuer":oauth.issuer,"authorization_endpoint":format!("{}/oauth/authorize",oauth.issuer),"token_endpoint":format!("{}/oauth/token",oauth.issuer),"registration_endpoint":format!("{}/oauth/register",oauth.issuer),"revocation_endpoint":format!("{}/oauth/revoke",oauth.issuer),"response_types_supported":["code"],"grant_types_supported":["authorization_code","refresh_token"],"token_endpoint_auth_methods_supported":["none","client_secret_post","client_secret_basic"],"revocation_endpoint_auth_methods_supported":["none","client_secret_post","client_secret_basic"],"code_challenge_methods_supported":["S256"],"scopes_supported":["nextleaf","offline_access"],"authorization_response_iss_parameter_supported":true}),
    )
}

#[derive(Deserialize)]
struct Registration {
    redirect_uris: Vec<String>,
    client_name: Option<String>,
    token_endpoint_auth_method: Option<String>,
    grant_types: Option<Vec<String>>,
    response_types: Option<Vec<String>>,
}
async fn register(
    State(oauth): State<Arc<OAuth>>,
    Json(input): Json<Registration>,
) -> Result<(StatusCode, Json<Value>)> {
    oauth.rate(0, 10)?;
    let method = input
        .token_endpoint_auth_method
        .as_deref()
        .unwrap_or("client_secret_basic");
    if !matches!(
        method,
        "none" | "client_secret_post" | "client_secret_basic"
    ) || input.grant_types.as_ref().is_some_and(|v| {
        v.iter()
            .any(|s| !matches!(s.as_str(), "authorization_code" | "refresh_token"))
    }) || input
        .response_types
        .as_ref()
        .is_some_and(|v| v.iter().any(|s| s != "code"))
    {
        return Err(error("invalid_client_metadata"));
    }
    if input.redirect_uris.is_empty()
        || input.redirect_uris.len() > 8
        || input
            .redirect_uris
            .iter()
            .any(|r| !oauth.redirects.contains(r))
    {
        return Err(error("invalid_redirect_uri"));
    }
    let name = input.client_name.as_deref().unwrap_or("MCP client");
    if name.len() > 100 {
        return Err(error("invalid_client_metadata"));
    }
    let id = secret();
    let client_secret = (method != "none").then(secret);
    let mut tx = oauth
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(database)?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM oauth_clients")
        .fetch_one(&mut *tx)
        .await
        .map_err(database)?;
    if count >= 256 {
        return Err(error("temporarily_unavailable"));
    }
    sqlx::query(
        "INSERT INTO oauth_clients(id,name,redirects,secret_hash,auth_method) VALUES(?,?,?,?,?)",
    )
    .bind(&id)
    .bind(name)
    .bind(json!(input.redirect_uris).to_string())
    .bind(client_secret.as_ref().map(|s| hash(s)))
    .bind(method)
    .execute(&mut *tx)
    .await
    .map_err(database)?;
    tx.commit().await.map_err(database)?;
    let mut body = json!({"client_id":id,"client_id_issued_at":now(),"client_name":name,"redirect_uris":input.redirect_uris,"token_endpoint_auth_method":method,"grant_types":["authorization_code","refresh_token"],"response_types":["code"]});
    if let Some(secret) = client_secret {
        body["client_secret"] = json!(secret);
        body["client_secret_expires_at"] = json!(0);
    }
    Ok((StatusCode::CREATED, Json(body)))
}

#[derive(Deserialize)]
struct Authorization {
    response_type: String,
    client_id: String,
    redirect_uri: String,
    state: String,
    code_challenge: String,
    code_challenge_method: String,
    scope: Option<String>,
    resource: Option<String>,
}
#[derive(FromRow)]
struct Client {
    name: String,
    redirects: String,
    secret_hash: Option<String>,
    auth_method: String,
}
async fn client(oauth: &OAuth, id: &str) -> Result<Client> {
    sqlx::query_as("SELECT name,redirects,secret_hash,auth_method FROM oauth_clients WHERE id=?")
        .bind(id)
        .fetch_optional(&oauth.pool)
        .await
        .map_err(database)?
        .ok_or_else(|| error("invalid_client"))
}
async fn authorize(
    State(oauth): State<Arc<OAuth>>,
    Query(input): Query<Authorization>,
) -> Result<Response> {
    oauth.rate(1, 60)?;
    oauth.resource(input.resource.as_deref())?;
    let client = client(&oauth, &input.client_id).await?;
    let redirects: Vec<String> =
        serde_json::from_str(&client.redirects).map_err(|_| error("server_error"))?;
    if !redirects.contains(&input.redirect_uri) || !oauth.redirects.contains(&input.redirect_uri) {
        return Err(error("invalid_redirect_uri"));
    }
    if input.response_type != "code"
        || input.code_challenge_method != "S256"
        || URL_SAFE_NO_PAD
            .decode(&input.code_challenge)
            .map_or(true, |s| s.len() != 32)
        || input.state.is_empty()
        || input.state.len() > 2048
    {
        return Err(error("invalid_request"));
    }
    let scope = input.scope.as_deref().unwrap_or("nextleaf");
    if scope
        .split_whitespace()
        .any(|s| !matches!(s, "nextleaf" | "offline_access"))
        || !scope.split_whitespace().any(|s| s == "nextleaf")
    {
        return Err(error("invalid_scope"));
    }
    let scope = if scope.split_whitespace().any(|s| s == "offline_access") {
        "nextleaf offline_access"
    } else {
        "nextleaf"
    };
    let nonce = secret();
    let mut tx = oauth
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(database)?;
    sqlx::query("DELETE FROM oauth_requests WHERE expires<=?")
        .bind(now())
        .execute(&mut *tx)
        .await
        .map_err(database)?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM oauth_requests")
        .fetch_one(&mut *tx)
        .await
        .map_err(database)?;
    if count >= 128 {
        return Err(error("temporarily_unavailable"));
    }
    sqlx::query("INSERT INTO oauth_requests(id_hash,client_id,redirect_uri,state,challenge,scope,expires,epoch) VALUES(?,?,?,?,?,?,?,?)")
        .bind(hash(&nonce)).bind(input.client_id).bind(&input.redirect_uri).bind(input.state).bind(input.code_challenge).bind(scope).bind(now()+600).bind(&oauth.epoch).execute(&mut *tx).await.map_err(database)?;
    tx.commit().await.map_err(database)?;
    let html = include_str!("oauth.html")
        .replace("{{client}}", &escaped(&client.name))
        .replace("{{redirect}}", &escaped(&input.redirect_uri))
        .replace("{{request}}", &nonce)
        .replace(
            "{{duration}}",
            if scope.contains("offline_access") {
                "Stay connected for up to 30 days."
            } else {
                "Access expires in one hour."
            },
        );
    let mut response = Html(html).into_response();
    // Chromium checks form-action against the OAuth redirect after form submission too.
    let callback_origin = reqwest::Url::parse(&input.redirect_uri)
        .map_err(|_| error("invalid_redirect_uri"))?.origin().ascii_serialization();
    let policy = PAGE_CSP.replace("form-action 'self'", &format!("form-action 'self' {callback_origin}"));
    response.headers_mut().insert(header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_str(&policy).map_err(|_| error("invalid_redirect_uri"))?);
    response.headers_mut().insert(
        header::SET_COOKIE,
        format!(
            "__Host-nextleaf-oauth={nonce}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600"
        )
        .parse()
        .unwrap(),
    );
    Ok(response)
}

#[derive(FromRow)]
struct Pending {
    client_id: String,
    redirect_uri: String,
    state: String,
    challenge: String,
    scope: String,
}
#[derive(Deserialize)]
struct Consent {
    request_id: String,
    password: String,
    decision: String,
}
async fn consent(
    State(oauth): State<Arc<OAuth>>,
    headers: HeaderMap,
    Form(input): Form<Consent>,
) -> Result<Response> {
    oauth.rate(2, 10)?;
    let cookie = headers
        .get(header::COOKIE)
        .and_then(|s| s.to_str().ok())
        .and_then(|s| {
            s.split(';')
                .find_map(|s| s.trim().strip_prefix("__Host-nextleaf-oauth="))
        })
        .unwrap_or("");
    if input.request_id.len() != 64 || !equal(cookie, &input.request_id) {
        return Err(error("invalid_request"));
    }
    let _login_slot = oauth.login_slot.try_acquire().map_err(|_| {
        (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"error":"temporarily_unavailable"})),
        )
    })?;
    if input.decision == "allow"
        && !verify_password(input.password.clone(), oauth.password_hash.clone()).await
    {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(
                json!({"error":"access_denied","error_description":"Incorrect owner password. Go back to try again."}),
            ),
        ));
    }
    let mut tx = oauth
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(database)?;
    let pending:Pending=sqlx::query_as("SELECT client_id,redirect_uri,state,challenge,scope FROM oauth_requests WHERE id_hash=? AND expires>? AND code_hash IS NULL AND epoch=?").bind(hash(&input.request_id)).bind(now()).bind(&oauth.epoch).fetch_optional(&mut *tx).await.map_err(database)?.ok_or_else(||error("invalid_request"))?;
    let mut redirect =
        reqwest::Url::parse(&pending.redirect_uri).map_err(|_| error("invalid_redirect_uri"))?;
    if input.decision == "allow" {
        let code = secret();
        sqlx::query("UPDATE oauth_requests SET code_hash=?,expires=? WHERE id_hash=?")
            .bind(hash(&code))
            .bind(now() + 120)
            .bind(hash(&input.request_id))
            .execute(&mut *tx)
            .await
            .map_err(database)?;
        redirect.query_pairs_mut().append_pair("code", &code);
    } else if input.decision == "deny" {
        sqlx::query("DELETE FROM oauth_requests WHERE id_hash=?")
            .bind(hash(&input.request_id))
            .execute(&mut *tx)
            .await
            .map_err(database)?;
        redirect
            .query_pairs_mut()
            .append_pair("error", "access_denied");
    } else {
        return Err(error("invalid_request"));
    }
    redirect
        .query_pairs_mut()
        .append_pair("state", &pending.state)
        .append_pair("iss", &oauth.issuer);
    tx.commit().await.map_err(database)?;
    let mut response = Redirect::to(redirect.as_str()).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static(
            "__Host-nextleaf-oauth=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
        ),
    );
    Ok(response)
}

#[derive(Deserialize, Default)]
struct TokenRequest {
    #[serde(default)]
    grant_type: String,
    client_id: Option<String>,
    client_secret: Option<String>,
    code: Option<String>,
    redirect_uri: Option<String>,
    code_verifier: Option<String>,
    refresh_token: Option<String>,
    resource: Option<String>,
    scope: Option<String>,
    token: Option<String>,
}
async fn authenticate(oauth: &OAuth, headers: &HeaderMap, input: &TokenRequest) -> Result<String> {
    let basic = headers
        .get(header::AUTHORIZATION)
        .and_then(|s| s.to_str().ok())
        .map(|v| {
            let text = String::from_utf8(
                STANDARD
                    .decode(
                        v.strip_prefix("Basic ")
                            .ok_or_else(|| error("invalid_client"))?,
                    )
                    .map_err(|_| error("invalid_client"))?,
            )
            .map_err(|_| error("invalid_client"))?;
            let (id, secret) = text
                .split_once(':')
                .ok_or_else(|| error("invalid_client"))?;
            Ok::<_, Error>((id.to_owned(), secret.to_owned()))
        })
        .transpose()?;
    if basic.is_some() && input.client_secret.is_some() {
        return Err(error("invalid_client"));
    }
    let id = basic
        .as_ref()
        .map(|s| s.0.as_str())
        .or(input.client_id.as_deref())
        .ok_or_else(|| error("invalid_client"))?;
    if input.client_id.as_ref().is_some_and(|other| other != id) {
        return Err(error("invalid_client"));
    }
    let client = client(oauth, id).await?;
    let supplied = basic
        .as_ref()
        .map(|s| s.1.as_str())
        .or(input.client_secret.as_deref())
        .unwrap_or("");
    let method = if basic.is_some() {
        "client_secret_basic"
    } else if input.client_secret.is_some() {
        "client_secret_post"
    } else {
        "none"
    };
    if method != client.auth_method
        || client
            .secret_hash
            .is_some_and(|h| !equal(&hash(supplied), &h))
    {
        return Err(error("invalid_client"));
    }
    Ok(id.to_owned())
}
#[derive(FromRow)]
struct Grant {
    id: String,
    client_id: String,
    scope: String,
    refresh_expires: i64,
    epoch: String,
}
async fn token(
    State(oauth): State<Arc<OAuth>>,
    headers: HeaderMap,
    Form(input): Form<TokenRequest>,
) -> Result<Json<Value>> {
    oauth.rate(3, 120)?;
    oauth.resource(input.resource.as_deref())?;
    let client_id = authenticate(&oauth, &headers, &input).await?;
    let mut tx = oauth
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(database)?;
    sqlx::query("DELETE FROM oauth_grants WHERE refresh_expires<=? OR epoch!=?")
        .bind(now())
        .bind(&oauth.epoch)
        .execute(&mut *tx)
        .await
        .map_err(database)?;
    sqlx::query("DELETE FROM oauth_used_refresh WHERE expires<=?")
        .bind(now())
        .execute(&mut *tx)
        .await
        .map_err(database)?;
    let (id, scope, refresh_expires) = match input.grant_type.as_str() {
        "authorization_code" => {
            let code = input
                .code
                .as_deref()
                .ok_or_else(|| error("invalid_grant"))?;
            let pending:Pending=sqlx::query_as("SELECT client_id,redirect_uri,state,challenge,scope FROM oauth_requests WHERE code_hash=? AND expires>? AND epoch=?").bind(hash(code)).bind(now()).bind(&oauth.epoch).fetch_optional(&mut *tx).await.map_err(database)?.ok_or_else(||error("invalid_grant"))?;
            let verifier = input.code_verifier.as_deref().unwrap_or("");
            if pending.client_id != client_id
                || input.redirect_uri.as_deref() != Some(pending.redirect_uri.as_str())
                || !(43..=128).contains(&verifier.len())
                || !verifier
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-._~".contains(&b))
                || !equal(
                    &URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
                    &pending.challenge,
                )
            {
                return Err(error("invalid_grant"));
            }
            sqlx::query("DELETE FROM oauth_requests WHERE code_hash=?")
                .bind(hash(code))
                .execute(&mut *tx)
                .await
                .map_err(database)?;
            let expiry = now()
                + if pending.scope.contains("offline_access") {
                    REFRESH_SECONDS
                } else {
                    ACCESS_SECONDS
                };
            (secret(), pending.scope, expiry)
        }
        "refresh_token" => {
            let refresh = hash(
                input
                    .refresh_token
                    .as_deref()
                    .ok_or_else(|| error("invalid_grant"))?,
            );
            let used: Option<String> =
                sqlx::query_scalar("SELECT grant_id FROM oauth_used_refresh WHERE hash=?")
                    .bind(&refresh)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(database)?;
            if let Some(id) = used {
                sqlx::query("DELETE FROM oauth_grants WHERE id=? AND client_id=?")
                    .bind(id)
                    .bind(&client_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(database)?;
                tx.commit().await.map_err(database)?;
                return Err(error("invalid_grant"));
            }
            let grant:Grant=sqlx::query_as("SELECT id,client_id,scope,refresh_expires,epoch FROM oauth_grants WHERE refresh_hash=?").bind(&refresh).fetch_optional(&mut *tx).await.map_err(database)?.ok_or_else(||error("invalid_grant"))?;
            if grant.client_id != client_id
                || grant.epoch != oauth.epoch
                || input.scope.as_ref().is_some_and(|s| s != &grant.scope)
            {
                return Err(error("invalid_grant"));
            }
            sqlx::query("INSERT INTO oauth_used_refresh(hash,grant_id,expires) VALUES(?,?,?)")
                .bind(refresh)
                .bind(&grant.id)
                .bind(grant.refresh_expires)
                .execute(&mut *tx)
                .await
                .map_err(database)?;
            sqlx::query("DELETE FROM oauth_grants WHERE id=?")
                .bind(&grant.id)
                .execute(&mut *tx)
                .await
                .map_err(database)?;
            (grant.id, grant.scope, grant.refresh_expires)
        }
        _ => return Err(error("unsupported_grant_type")),
    };
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM oauth_grants")
        .fetch_one(&mut *tx)
        .await
        .map_err(database)?;
    let used: i64 = sqlx::query_scalar("SELECT count(*) FROM oauth_used_refresh")
        .fetch_one(&mut *tx)
        .await
        .map_err(database)?;
    if count >= 256 || used >= 20000 {
        return Err(error("temporarily_unavailable"));
    }
    let access = secret();
    let refresh = scope.contains("offline_access").then(secret);
    let expires = (now() + ACCESS_SECONDS).min(refresh_expires);
    sqlx::query("INSERT INTO oauth_grants(id,client_id,access_hash,refresh_hash,scope,expires,refresh_expires,epoch) VALUES(?,?,?,?,?,?,?,?)")
        .bind(id).bind(client_id).bind(hash(&access)).bind(refresh.as_ref().map(|s|hash(s))).bind(&scope).bind(expires).bind(refresh_expires).bind(&oauth.epoch).execute(&mut *tx).await.map_err(database)?;
    tx.commit().await.map_err(database)?;
    let mut body = json!({"access_token":access,"token_type":"Bearer","expires_in":expires-now(),"scope":scope});
    if let Some(refresh) = refresh {
        body["refresh_token"] = json!(refresh);
    }
    Ok(Json(body))
}
async fn revoke(
    State(oauth): State<Arc<OAuth>>,
    headers: HeaderMap,
    Form(input): Form<TokenRequest>,
) -> Result<StatusCode> {
    oauth.rate(3, 120)?;
    let client = authenticate(&oauth, &headers, &input).await?;
    let token = hash(
        input
            .token
            .as_deref()
            .ok_or_else(|| error("invalid_request"))?,
    );
    sqlx::query("DELETE FROM oauth_grants WHERE client_id=? AND (access_hash=? OR refresh_hash=?)")
        .bind(client)
        .bind(&token)
        .bind(&token)
        .execute(&oauth.pool)
        .await
        .map_err(database)?;
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests;
