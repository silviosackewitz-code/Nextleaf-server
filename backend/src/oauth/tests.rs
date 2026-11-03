use super::*;
use axum::body::{to_bytes, Body};
use tower::ServiceExt;

const ISSUER: &str = "https://nextleaf.example.ts.net:8443";
const HOST: &str = "nextleaf.example.ts.net:8443";
const CALLBACK: &str = "https://claude.ai/api/mcp/auth_callback";
const PASSWORD_HASH:&str="scrypt$000102030405060708090a0b0c0d0e0f$4cb7c00e046f416e986200cd7ee0fd1212a29765fab03235cf1f201886908b52";
const VERIFIER: &str = "test-verifier-0123456789012345678901234567890123456789";

async fn setup() -> (Arc<OAuth>, Router) {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let oauth =
        Arc::new(OAuth::new(pool.clone(), ISSUER, PASSWORD_HASH, DEFAULT_REDIRECTS).unwrap());
    let app = crate::mcp::authenticated_router(
        crate::AppState { pool },
        None,
        vec!["nextleaf.example.ts.net".into()],
        Some(oauth.clone()),
    )
    .unwrap();
    (oauth, app)
}
fn form(pairs: &[(&str, &str)]) -> String {
    let mut u = reqwest::Url::parse("https://example.invalid").unwrap();
    u.query_pairs_mut().extend_pairs(pairs.iter().copied());
    u.query().unwrap().to_owned()
}
async fn send(
    app: &Router,
    method: &str,
    path: &str,
    body: &str,
    headers: &[(&str, &str)],
) -> (StatusCode, HeaderMap, String) {
    let mut req = axum::http::Request::builder()
        .method(method)
        .uri(path)
        .header("host", HOST);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let res = app
        .clone()
        .oneshot(req.body(Body::from(body.to_owned())).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let body = to_bytes(res.into_body(), 1_000_000).await.unwrap();
    (status, headers, String::from_utf8(body.to_vec()).unwrap())
}
async fn post(app: &Router, path: &str, pairs: &[(&str, &str)]) -> (StatusCode, Value) {
    let (status, _, text) = send(
        app,
        "POST",
        path,
        &form(pairs),
        &[("content-type", "application/x-www-form-urlencoded")],
    )
    .await;
    (status, serde_json::from_str(&text).unwrap_or(json!(text)))
}
async fn registered(app: &Router, method: &str) -> Value {
    let body = json!({"client_name":"Test <agent>","redirect_uris":[CALLBACK],"token_endpoint_auth_method":method});
    let (status, _, body) = send(
        app,
        "POST",
        "/oauth/register",
        &body.to_string(),
        &[("content-type", "application/json")],
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    serde_json::from_str(&body).unwrap()
}
async fn login_form(app: &Router, id: &str) -> (String, String) {
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(VERIFIER.as_bytes()));
    let query = form(&[
        ("response_type", "code"),
        ("client_id", id),
        ("redirect_uri", CALLBACK),
        ("state", "original-state"),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
        ("scope", "nextleaf offline_access"),
        ("resource", &format!("{ISSUER}/mcp")),
    ]);
    let (status, headers, body) =
        send(app, "GET", &format!("/oauth/authorize?{query}"), "", &[]).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("Test &lt;agent&gt;"));
    assert!(!body.contains("Test <agent>"));
    assert_eq!(headers[header::CACHE_CONTROL], "no-store");
    assert_eq!(headers[header::REFERRER_POLICY], "same-origin");
    let csp = headers[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
    assert!(csp.contains("form-action 'self' https://claude.ai;"));
    assert!(csp.contains("default-src 'none'"));
    assert!(csp.contains("frame-ancestors 'none'"));
    assert!(!csp.contains("chatgpt.com"));
    let cookie = headers[header::SET_COOKIE].to_str().unwrap();
    assert!(cookie.contains("Secure; HttpOnly; SameSite=Lax"));
    let cookie = cookie.split(';').next().unwrap().to_owned();
    (cookie.split_once('=').unwrap().1.to_owned(), cookie)
}
async fn issued_code(oauth: &OAuth, id: &str) -> String {
    let code = secret();
    sqlx::query("INSERT INTO oauth_requests(id_hash,client_id,redirect_uri,state,challenge,scope,expires,code_hash,epoch) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(hash(&secret())).bind(id).bind(CALLBACK).bind("state").bind(URL_SAFE_NO_PAD.encode(Sha256::digest(VERIFIER.as_bytes()))).bind("nextleaf offline_access").bind(now()+120).bind(hash(&code)).bind(&oauth.epoch).execute(&oauth.pool).await.unwrap();
    code
}
async fn exchange(app: &Router, id: &str, code: &str) -> Value {
    let (status, body) = post(
        app,
        "/oauth/token",
        &[
            ("grant_type", "authorization_code"),
            ("client_id", id),
            ("code", code),
            ("redirect_uri", CALLBACK),
            ("code_verifier", VERIFIER),
            ("resource", &format!("{ISSUER}/mcp")),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

#[tokio::test]
async fn discovery_registration_and_public_boundary() {
    let (_, app) = setup().await;
    let (status, headers, _) = send(&app, "POST", "/mcp", "{}", &[]).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(headers[header::WWW_AUTHENTICATE]
        .to_str()
        .unwrap()
        .contains("resource_metadata="));
    for path in [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-authorization-server",
    ] {
        let (status, _, body) = send(&app, "GET", path, "", &[]).await;
        assert_eq!(status, StatusCode::OK);
        let body: Value = serde_json::from_str(&body).unwrap();
        if path.contains("authorization-server") {
            assert_eq!(body["code_challenge_methods_supported"], json!(["S256"]));
            assert_eq!(body["issuer"], ISSUER);
        } else {
            assert_eq!(body["resource"], format!("{ISSUER}/mcp"));
        }
    }
    for redirect in [
        "https://evil.example/callback",
        "https://claude.ai/api/mcp/auth_callback/extra",
        "http://claude.ai/api/mcp/auth_callback",
        "javascript:alert(1)",
    ] {
        let body = json!({"redirect_uris":[redirect]});
        assert_eq!(
            send(
                &app,
                "POST",
                "/oauth/register",
                &body.to_string(),
                &[("content-type", "application/json")]
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        send(
            &app,
            "GET",
            "/.well-known/oauth-authorization-server",
            "",
            &[("origin", "https://evil.example")]
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    for method in ["none", "client_secret_post", "client_secret_basic"] {
        registered(&app, method).await;
    }
}

#[tokio::test]
async fn login_requires_password_cookie_and_explicit_consent() {
    let (_, app) = setup().await;
    let registration = registered(&app, "none").await;
    let id = registration["client_id"].as_str().unwrap();
    let (request, cookie) = login_form(&app, id).await;
    let input = form(&[
        ("request_id", &request),
        ("password", "wrong"),
        ("decision", "allow"),
    ]);
    assert_eq!(
        send(
            &app,
            "POST",
            "/oauth/authorize",
            &input,
            &[("content-type", "application/x-www-form-urlencoded")]
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    for origin in ["null", "https://evil.example"] {
        assert_eq!(
            send(&app, "POST", "/oauth/authorize", &input, &[
                ("content-type", "application/x-www-form-urlencoded"),
                ("cookie", cookie.as_str()),
                ("origin", origin),
            ]).await.0,
            StatusCode::FORBIDDEN
        );
    }
    let headers = [
        ("content-type", "application/x-www-form-urlencoded"),
        ("cookie", cookie.as_str()),
        ("origin", ISSUER),
    ];
    assert_eq!(
        send(&app, "POST", "/oauth/authorize", &input, &headers)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let input = form(&[
        ("request_id", &request),
        ("password", "nextleaf-test-password-only"),
        ("decision", "allow"),
    ]);
    let (status, headers, _) = send(&app, "POST", "/oauth/authorize", &input, &headers).await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    let redirect = reqwest::Url::parse(headers[header::LOCATION].to_str().unwrap()).unwrap();
    let query: std::collections::HashMap<_, _> = redirect.query_pairs().into_owned().collect();
    assert_eq!(query["state"], "original-state");
    assert_eq!(query["iss"], ISSUER);
    exchange(&app, id, &query["code"]).await;
    let (request, cookie) = login_form(&app, id).await;
    let (status, headers, _) = send(
        &app,
        "POST",
        "/oauth/authorize",
        &form(&[
            ("request_id", &request),
            ("password", ""),
            ("decision", "deny"),
        ]),
        &[
            ("content-type", "application/x-www-form-urlencoded"),
            ("cookie", &cookie),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    assert!(headers[header::LOCATION]
        .to_str()
        .unwrap()
        .contains("error=access_denied"));
}

#[tokio::test]
async fn pkce_audience_code_replay_refresh_rotation_and_revocation() {
    let (oauth, app) = setup().await;
    let registration = registered(&app, "none").await;
    let id = registration["client_id"].as_str().unwrap();
    let code = issued_code(&oauth, id).await;
    for (key, value) in [
        ("code_verifier", "wrong"),
        ("redirect_uri", "https://evil.example"),
        ("resource", "https://other.example/mcp"),
    ] {
        let mut pairs = vec![
            ("grant_type", "authorization_code"),
            ("client_id", id),
            ("code", &code),
            ("redirect_uri", CALLBACK),
            ("code_verifier", VERIFIER),
        ];
        pairs.retain(|(k, _)| *k != key);
        pairs.push((key, value));
        assert_eq!(
            post(&app, "/oauth/token", &pairs).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    let tokens = exchange(&app, id, &code).await;
    let access = tokens["access_token"].as_str().unwrap();
    let refresh = tokens["refresh_token"].as_str().unwrap();
    assert!(oauth.accepts(access).await.unwrap());
    assert_eq!(
        post(
            &app,
            "/oauth/token",
            &[
                ("grant_type", "authorization_code"),
                ("client_id", id),
                ("code", &code),
                ("redirect_uri", CALLBACK),
                ("code_verifier", VERIFIER)
            ]
        )
        .await
        .1["error"],
        "invalid_grant"
    );
    let bearer = format!("Bearer {access}");
    for path in ["/", "/index.html", "/api/tasks", "/api/sync", "/api/health"] {
        assert_eq!(
            send(&app, "GET", path, "", &[("authorization", &bearer)])
                .await
                .0,
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    let rpc = json!({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}});
    assert_eq!(
        send(
            &app,
            "POST",
            "/mcp",
            &rpc.to_string(),
            &[
                ("authorization", &bearer),
                ("content-type", "application/json"),
                ("accept", "application/json, text/event-stream"),
                ("mcp-protocol-version", "2025-11-25")
            ]
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, renewed) = post(
        &app,
        "/oauth/token",
        &[
            ("grant_type", "refresh_token"),
            ("client_id", id),
            ("refresh_token", refresh),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let current = renewed["access_token"].as_str().unwrap();
    assert!(oauth.accepts(current).await.unwrap());
    assert!(!oauth.accepts(access).await.unwrap());
    assert_eq!(
        post(
            &app,
            "/oauth/token",
            &[
                ("grant_type", "refresh_token"),
                ("client_id", id),
                ("refresh_token", refresh)
            ]
        )
        .await
        .1["error"],
        "invalid_grant"
    );
    assert!(
        !oauth.accepts(current).await.unwrap(),
        "refresh replay revokes its grant family"
    );
    let tokens = exchange(&app, id, &issued_code(&oauth, id).await).await;
    assert_eq!(
        post(
            &app,
            "/oauth/revoke",
            &[
                ("client_id", id),
                ("token", tokens["refresh_token"].as_str().unwrap())
            ]
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(!oauth
        .accepts(tokens["access_token"].as_str().unwrap())
        .await
        .unwrap());
}

#[tokio::test]
async fn expiry_rotation_and_client_authentication_are_enforced() {
    let (oauth, app) = setup().await;
    for method in ["client_secret_post", "client_secret_basic"] {
        let registration = registered(&app, method).await;
        let id = registration["client_id"].as_str().unwrap();
        let secret = registration["client_secret"].as_str().unwrap();
        let code = issued_code(&oauth, id).await;
        let mut pairs = vec![
            ("grant_type", "authorization_code"),
            ("client_id", id),
            ("code", &code),
            ("redirect_uri", CALLBACK),
            ("code_verifier", VERIFIER),
        ];
        assert_eq!(
            post(&app, "/oauth/token", &pairs).await.1["error"],
            "invalid_client"
        );
        let basic = format!("Basic {}", STANDARD.encode(format!("{id}:{secret}")));
        let mut headers = vec![("content-type", "application/x-www-form-urlencoded")];
        if method == "client_secret_post" {
            pairs.push(("client_secret", secret));
        } else {
            headers.push(("authorization", &basic));
        }
        let (status, _, body) = send(&app, "POST", "/oauth/token", &form(&pairs), &headers).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let tokens: Value = serde_json::from_str(&body).unwrap();
        let access = tokens["access_token"].as_str().unwrap();
        sqlx::query("UPDATE oauth_grants SET expires=0")
            .execute(&oauth.pool)
            .await
            .unwrap();
        assert!(!oauth.accepts(access).await.unwrap());
        sqlx::query("UPDATE oauth_grants SET refresh_expires=0")
            .execute(&oauth.pool)
            .await
            .unwrap();
        let mut refresh = vec![
            ("grant_type", "refresh_token"),
            ("client_id", id),
            ("refresh_token", tokens["refresh_token"].as_str().unwrap()),
        ];
        if method == "client_secret_post" {
            refresh.push(("client_secret", secret));
        }
        assert_eq!(
            send(&app, "POST", "/oauth/token", &form(&refresh), &headers)
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
    let registration = registered(&app, "none").await;
    let id = registration["client_id"].as_str().unwrap();
    let code = issued_code(&oauth, id).await;
    sqlx::query("UPDATE oauth_requests SET expires=0")
        .execute(&oauth.pool)
        .await
        .unwrap();
    assert_eq!(
        post(
            &app,
            "/oauth/token",
            &[
                ("grant_type", "authorization_code"),
                ("client_id", id),
                ("code", &code),
                ("redirect_uri", CALLBACK),
                ("code_verifier", VERIFIER)
            ]
        )
        .await
        .1["error"],
        "invalid_grant"
    );
    let tokens = exchange(&app, id, &issued_code(&oauth, id).await).await;
    let changed = OAuth::new(
        oauth.pool.clone(),
        "https://changed.example",
        PASSWORD_HASH,
        DEFAULT_REDIRECTS,
    )
    .unwrap();
    assert!(!changed
        .accepts(tokens["access_token"].as_str().unwrap())
        .await
        .unwrap());
    let changed = OAuth::new(
        oauth.pool.clone(),
        ISSUER,
        &PASSWORD_HASH.replace("4cb7c00e", "5cb7c00e"),
        DEFAULT_REDIRECTS,
    )
    .unwrap();
    assert!(!changed
        .accepts(tokens["access_token"].as_str().unwrap())
        .await
        .unwrap());
}

#[tokio::test]
async fn invalid_configuration_pkce_scope_and_limits_fail_closed() {
    let (oauth, app) = setup().await;
    for issuer in [
        "http://nextleaf.example",
        "https://user:password@example.com",
        "https://example.com/path",
        "https://example.com?x=1",
    ] {
        assert!(OAuth::new(oauth.pool.clone(), issuer, PASSWORD_HASH, DEFAULT_REDIRECTS).is_err());
    }
    assert!(OAuth::new(oauth.pool.clone(), ISSUER, "weak", DEFAULT_REDIRECTS).is_err());
    let registration = registered(&app, "none").await;
    let id = registration["client_id"].as_str().unwrap();
    for method in ["plain", "S256"] {
        let query = form(&[
            ("response_type", "code"),
            ("client_id", id),
            ("redirect_uri", CALLBACK),
            ("state", "state"),
            ("code_challenge", "invalid"),
            ("code_challenge_method", method),
        ]);
        assert_eq!(
            send(&app, "GET", &format!("/oauth/authorize?{query}"), "", &[])
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(VERIFIER.as_bytes()));
    for scope in ["admin", "offline_access", "nextleaf openid"] {
        let query = form(&[
            ("response_type", "code"),
            ("client_id", id),
            ("redirect_uri", CALLBACK),
            ("state", "state"),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
            ("scope", scope),
        ]);
        assert_eq!(
            send(&app, "GET", &format!("/oauth/authorize?{query}"), "", &[])
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
    for _ in 0..10 {
        let _ = oauth.rate(0, 10);
    }
    assert_eq!(
        oauth.rate(0, 10).unwrap_err().0,
        StatusCode::TOO_MANY_REQUESTS
    );
}
