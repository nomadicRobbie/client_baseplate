// minio: bucket operations (initStorage) — avoids AWS SDK checksum headers that MinIO rejects.
// @aws-sdk/s3-request-presigner: presignPut() — pure URL construction, no HTTP to MinIO.
import * as Minio from 'minio'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'
import { config } from '../config'

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
  'image/gif':  '.gif',
  'application/pdf': '.pdf',
}

export const ALLOWED_MIME = new Set(Object.keys(MIME_TO_EXT))

// ── Minio client (bucket operations only) ────────────────────────────────────

let _minio: Minio.Client | null = null
function minioClient(): Minio.Client {
  if (!_minio) {
    const url = new URL(config.storage.endpoint)
    _minio = new Minio.Client({
      endPoint: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      useSSL: url.protocol === 'https:',
      accessKey: config.storage.accessKey,
      secretKey: config.storage.secretKey,
    })
  }
  return _minio
}

// ── S3 client (presigned URL construction only — no real HTTP to MinIO) ──────

let _s3: S3Client | null = null
function s3Client(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: 'us-east-1',
      endpoint: config.storage.endpoint,
      credentials: { accessKeyId: config.storage.accessKey, secretAccessKey: config.storage.secretKey },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }
  return _s3
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function initStorage(): Promise<void> {
  const c = minioClient()
  const bucket = config.storage.bucket

  const exists = await c.bucketExists(bucket)
  if (!exists) await c.makeBucket(bucket)

  await c.setBucketPolicy(bucket, JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { AWS: ['*'] },
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${bucket}/*`],
    }],
  }))

  // ponytail: minio JS client doesn't expose setBucketCors; configure CORS via
  // MinIO console (Settings → CORS) if Expo web presigned PUTs are needed.
}

export async function presignPut(mimetype: string): Promise<{ presignedUrl: string; publicUrl: string }> {
  const ext = MIME_TO_EXT[mimetype] ?? ''
  const key = `${config.tenantSlug}/${randomUUID()}${ext}`
  const command = new PutObjectCommand({ Bucket: config.storage.bucket, Key: key, ContentType: mimetype })
  const presignedUrl = await getSignedUrl(s3Client(), command, { expiresIn: 300 })
  return { presignedUrl, publicUrl: `${config.storage.publicUrl}/${key}` }
}
