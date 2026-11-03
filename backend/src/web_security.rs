use axum::{
    extract::{Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

fn allowed(headers: &axum::http::HeaderMap, hosts: &[String]) -> bool {
    let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let Ok(authority) = host.parse::<axum::http::uri::Authority>() else {
        return false;
    };
    if !hosts
        .iter()
        .any(|h| h.eq_ignore_ascii_case(authority.host()))
    {
        return false;
    }
    if let Some(origin) = headers.get(header::ORIGIN) {
        let Some(origin) = origin
            .to_str()
            .ok()
            .and_then(|v| v.parse::<axum::http::Uri>().ok())
        else {
            return false;
        };
        if !matches!(origin.scheme_str(), Some("http" | "https"))
            || !origin
                .authority()
                .is_some_and(|a| a.as_str().eq_ignore_ascii_case(host))
        {
            return false;
        }
    }
    true
}

pub(crate) async fn protect(
    State(hosts): State<Vec<String>>,
    request: Request,
    next: Next,
) -> Response {
    let mut response = if allowed(request.headers(), &hosts) {
        next.run(request).await
    } else {
        (StatusCode::FORBIDDEN, axum::Json(serde_json::json!({"error":"Untrusted Host or Origin. Configure NEXTLEAF_HTTP_HOSTS for this server."}))).into_response()
    };
    response
        .headers_mut()
        .insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("frame-ancestors 'none'"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn host_and_origin_block_rebinding_and_cross_site_requests() {
        let hosts = vec!["localhost".into(), "nextleaf.example.ts.net".into()];
        for (host, origin, expected) in [
            ("localhost:8787", None, true),
            (
                "nextleaf.example.ts.net",
                Some("https://nextleaf.example.ts.net"),
                true,
            ),
            ("attacker.example", None, false),
            ("localhost:8787", Some("https://attacker.example"), false),
            ("localhost:8787", Some("http://localhost:1420"), false),
            ("localhost:8787", Some("null"), false),
        ] {
            let mut headers = axum::http::HeaderMap::new();
            headers.insert(header::HOST, host.parse().unwrap());
            if let Some(origin) = origin {
                headers.insert(header::ORIGIN, origin.parse().unwrap());
            }
            assert_eq!(allowed(&headers, &hosts), expected, "{host} {origin:?}");
        }
    }
}
