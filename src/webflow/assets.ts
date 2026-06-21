import SparkMD5 from "spark-md5";
import { ASSET_FOLDER_NAME } from "../constants";
import type { WebflowCollectionSummary } from "./client";

const WEBFLOW_API_BASE = "https://api.webflow.com/v2";

interface AssetFolder {
  id: string;
  displayName: string;
}

interface AssetUploadInit {
  id: string;
  hostedUrl?: string;
  uploadUrl?: string;
  uploadDetails?: Record<string, string>;
}

function md5Hex(buffer: ArrayBuffer): string {
  return SparkMD5.ArrayBuffer.hash(buffer);
}

async function webflowJson<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${WEBFLOW_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webflow Assets API ${response.status}: ${text.slice(0, 400)}`);
  }
  return response.json() as Promise<T>;
}

export async function getOrCreateAssetFolder(
  token: string,
  siteId: string,
): Promise<string> {
  const list = await webflowJson<{ assetFolders: AssetFolder[] }>(
    token,
    `/sites/${siteId}/asset_folders`,
  );
  const existing = (list.assetFolders ?? []).find((f) => f.displayName === ASSET_FOLDER_NAME);
  if (existing?.id) return existing.id;

  const created = await webflowJson<AssetFolder>(token, `/sites/${siteId}/asset_folders`, {
    method: "POST",
    body: JSON.stringify({ displayName: ASSET_FOLDER_NAME }),
  });
  return created.id;
}

export async function uploadAsset(
  token: string,
  siteId: string,
  parentFolderId: string,
  fileName: string,
  bytes: ArrayBuffer,
): Promise<{ fileId: string; url: string }> {
  const fileHash = md5Hex(bytes);
  const init = await webflowJson<AssetUploadInit>(token, `/sites/${siteId}/assets`, {
    method: "POST",
    body: JSON.stringify({
      fileName: fileName.slice(0, 99),
      fileHash,
      parentFolder: parentFolderId,
    }),
  });

  if (!init.uploadUrl || !init.uploadDetails) {
    if (init.id && init.hostedUrl) {
      return { fileId: init.id, url: init.hostedUrl };
    }
    throw new Error("Webflow asset upload missing uploadUrl/uploadDetails");
  }

  const form = new FormData();
  for (const [key, value] of Object.entries(init.uploadDetails)) {
    form.append(key, value);
  }
  form.append("file", new Blob([bytes]), fileName);

  const s3Response = await fetch(init.uploadUrl, { method: "POST", body: form });
  if (!s3Response.ok) {
    const text = await s3Response.text();
    throw new Error(`S3 asset upload failed ${s3Response.status}: ${text.slice(0, 300)}`);
  }

  if (!init.id || !init.hostedUrl) {
    throw new Error("Webflow asset upload missing id/hostedUrl after S3 upload");
  }

  return { fileId: init.id, url: init.hostedUrl };
}

export function guessFileName(url: string, suffix: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (last && /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(last)) {
      return last.slice(0, 200);
    }
  } catch {
    /* ignore */
  }
  const safe = String(suffix)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 120);
  return `airtable-sync-${safe || "img"}.jpg`;
}

/** No-op placeholder for type imports */
export type _WebflowCollectionSummary = WebflowCollectionSummary;
