import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

// Local file type alias — avoids Express.Multer.File namespace issues
type MulterFile = { fieldname: string; originalname: string; encoding: string; mimetype: string; size: number; buffer: Buffer; };

export interface UploadResult {
  key: string;
  size: number;
  mimeType: string;
}

// Allowed MIME types for CAD files
const ALLOWED_CAD_MIMETYPES = new Set([
  'application/octet-stream',       // generic binary (DWG/DXF often use this)
  'application/acad',               // AutoCAD DWG
  'image/vnd.dwg',
  'image/x-dwg',
  'application/dxf',
  'application/x-dxf',
]);

// Allowed MIME types for preview images
const ALLOWED_IMAGE_MIMETYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MAX_CAD_FILE_SIZE = 200 * 1024 * 1024;    // 200 MB
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;         // 20 MB

@Injectable()
export class StorageService {
  private s3Client: S3Client;
  private privateBucket: string;
  private publicBucket: string;

  constructor(private configService?: ConfigService) {
    const get = (k: string, def = '') => this.configService?.get<string>(k) || process.env[k] || def;
    this.s3Client = new S3Client({
      region: get('AWS_REGION', 'auto'),
      endpoint: get('AWS_S3_ENDPOINT') || undefined,
      credentials: {
        accessKeyId: get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: get('AWS_SECRET_ACCESS_KEY'),
      },
      forcePathStyle: true,
    });
    this.privateBucket = get('AWS_S3_BUCKET_NAME', 'cad-marketplace-files');
    this.publicBucket = get('AWS_S3_PUBLIC_BUCKET_NAME', 'cad-marketplace-public');
  }

  /**
   * Upload a CAD file to the private bucket.
   * Validates MIME type and file size.
   */
  async uploadCadFile(file: MulterFile, folder = 'cad-files'): Promise<UploadResult> {
    if (file.size > MAX_CAD_FILE_SIZE) {
      throw new BadRequestException(`File too large. Max ${MAX_CAD_FILE_SIZE / 1024 / 1024}MB`);
    }

    // Extension whitelist (MIME can be spoofed)
    const ext = file.originalname.toLowerCase().split('.').pop();
    const allowedExts = ['dwg', 'dxf', 'skp', 'rvt', 'ifc', 'step', 'stp', '3ds', 'max'];
    if (!allowedExts.includes(ext)) {
      throw new BadRequestException(`File extension .${ext} is not allowed`);
    }

    const key = `${folder}/${uuidv4()}-${Date.now()}.${ext}`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.privateBucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
        // No public-read ACL — private bucket
      }),
    );

    return { key, size: file.size, mimeType: file.mimetype };
  }

  /**
   * Upload a watermarked preview image.
   * Burns "WATERMARK" text into the image pixels (cannot be removed via devtools).
   */
  async uploadPreviewImage(
    file: MulterFile,
    watermarkText = '© CAD Marketplace — preview only',
    folder = 'previews',
  ): Promise<UploadResult> {
    if (file.size > MAX_IMAGE_SIZE) {
      throw new BadRequestException(`Image too large. Max ${MAX_IMAGE_SIZE / 1024 / 1024}MB`);
    }

    const ext = file.originalname.toLowerCase().split('.').pop();
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      throw new BadRequestException(`Image extension .${ext} is not allowed`);
    }

    // Get image dimensions
    const metadata = await sharp(file.buffer).metadata();
    const { width = 800, height = 600 } = metadata;

    // Build SVG watermark overlay
    const fontSize = Math.max(20, Math.floor(width / 25));
    const watermarkSvg = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <text 
          x="50%" y="50%"
          font-family="Arial, sans-serif"
          font-size="${fontSize}"
          fill="rgba(255,255,255,0.55)"
          text-anchor="middle"
          dominant-baseline="middle"
          transform="rotate(-30, ${width / 2}, ${height / 2})"
        >${watermarkText}</text>
        <text 
          x="50%" y="80%"
          font-family="Arial, sans-serif"
          font-size="${Math.floor(fontSize * 0.7)}"
          fill="rgba(255,255,255,0.40)"
          text-anchor="middle"
          dominant-baseline="middle"
        >${watermarkText}</text>
      </svg>
    `);

    // Burn watermark into pixels (flatten transparency with white background for clean CAD rendering)
    const watermarkedBuffer = await sharp(file.buffer)
      .flatten({ background: '#ffffff' })
      .composite([{ input: watermarkSvg, blend: 'over' }])
      .jpeg({ quality: 90 })
      .toBuffer();

    const key = `${folder}/${uuidv4()}-${Date.now()}.jpg`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.publicBucket,
        Key: key,
        Body: watermarkedBuffer,
        ContentType: 'image/jpeg',
        // Public read for preview images
        ACL: 'public-read' as any,
      }),
    );

    return { key, size: watermarkedBuffer.length, mimeType: 'image/jpeg' };
  }

  /**
   * Upload a thumbnail (small preview, no watermark needed at thumbnail size).
   */
  async uploadThumbnail(file: MulterFile, folder = 'thumbnails'): Promise<UploadResult> {
    const thumbnailBuffer = await sharp(file.buffer)
      .flatten({ background: '#ffffff' })
      .resize(400, 300, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const key = `${folder}/${uuidv4()}-${Date.now()}.jpg`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.publicBucket,
        Key: key,
        Body: thumbnailBuffer,
        ContentType: 'image/jpeg',
        ACL: 'public-read' as any,
      }),
    );

    return { key, size: thumbnailBuffer.length, mimeType: 'image/jpeg' };
  }

  /**
   * Generate a short-lived pre-signed URL for a private CAD file download.
   * This is the ONLY way the browser ever gets a download link.
   */
  async getPresignedDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.privateBucket,
      Key: key,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Get the public URL for preview/thumbnail images.
   */
  getPublicUrl(key: string): string {
    const endpoint = this.configService.get<string>('AWS_S3_ENDPOINT');
    return `${endpoint}/${this.publicBucket}/${key}`;
  }

  /**
   * Get an object stream for media serving.
   */
  async getObjectStream(bucket: 'private' | 'public', key: string) {
    const bucketName = bucket === 'private' ? this.privateBucket : this.publicBucket;
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    return this.s3Client.send(command);
  }

  /**
   * Delete an object from storage (used when admin deletes a product).
   */
  async deleteObject(bucket: 'private' | 'public', key: string): Promise<void> {
    const bucketName = bucket === 'private' ? this.privateBucket : this.publicBucket;
    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: bucketName, Key: key }),
    );
  }
}
