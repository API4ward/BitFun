//! User secret variables — settings CRUD (values never returned).

use bitfun_core::user_secrets::{
    delete_user_secret as delete_user_secret_inner, list_user_secrets as list_user_secrets_inner,
    upsert_user_secret as upsert_user_secret_inner,
};
use bitfun_core_types::{UserSecretSummary, UserSecretUpsert};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertUserSecretRequest {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteUserSecretRequest {
    pub name: String,
}

#[tauri::command]
pub async fn list_user_secrets() -> Result<Vec<UserSecretSummary>, String> {
    list_user_secrets_inner().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upsert_user_secret(
    request: UpsertUserSecretRequest,
) -> Result<UserSecretSummary, String> {
    upsert_user_secret_inner(UserSecretUpsert {
        name: request.name,
        value: request.value,
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_user_secret(request: DeleteUserSecretRequest) -> Result<bool, String> {
    delete_user_secret_inner(&request.name)
        .await
        .map_err(|e| e.to_string())
}
