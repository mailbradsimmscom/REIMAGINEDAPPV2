/**
 * Photo Storage Service
 * Handles uploading photos to Supabase Storage for supplies, anchorages, etc.
 */

import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';

const BUCKET = 'documents';
const SUPPLY_FOLDER = 'supply-photos';
const ANCHORAGE_FOLDER = 'anchorage-photos';
const requestLogger = logger.createRequestLogger();

/**
 * Upload a supply photo to Supabase Storage
 * @param {string} supplyId - The supply UUID
 * @param {string} base64Data - Base64 data URL (data:image/jpeg;base64,...)
 * @param {number} photoIndex - Photo index (1-based, default 1)
 * @returns {Promise<string>} Public URL of uploaded photo
 */
export async function uploadSupplyPhoto(supplyId, base64Data, photoIndex = 1) {
  const supabase = await getSupabaseClient();

  if (!supabase) {
    throw new Error('Supabase client not available');
  }

  if (!supplyId) {
    throw new Error('Supply ID is required');
  }

  if (!base64Data || !base64Data.startsWith('data:image/')) {
    throw new Error('Invalid base64 image data');
  }

  try {
    // Extract mime type and base64 content
    const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 data URL format');
    }

    const imageType = matches[1]; // jpeg, png, etc.
    const base64Content = matches[2];

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Content, 'base64');

    // Generate filename: {supply_id}-{index}.{ext}
    const extension = imageType === 'jpeg' ? 'jpg' : imageType;
    const filename = `${supplyId}-${photoIndex}.${extension}`;
    const filePath = `${SUPPLY_FOLDER}/${filename}`;

    requestLogger.info('Uploading supply photo', {
      supplyId,
      photoIndex,
      filename,
      filePath,
      fileSize: buffer.length,
      imageType
    });

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, buffer, {
        contentType: `image/${imageType}`,
        upsert: true // Allow overwriting if photo already exists
      });

    if (error) {
      requestLogger.error('Supabase Storage upload error', {
        error: error.message,
        code: error.code,
        supplyId,
        filePath
      });
      throw new Error(`Failed to upload photo: ${error.message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    const publicUrl = urlData.publicUrl;

    requestLogger.info('Supply photo uploaded successfully', {
      supplyId,
      photoIndex,
      filePath: data.path,
      publicUrl
    });

    return publicUrl;

  } catch (error) {
    requestLogger.error('Photo upload failed', {
      error: error.message,
      supplyId,
      photoIndex
    });
    throw error;
  }
}

/**
 * Delete a supply photo from Supabase Storage
 * @param {string} supplyId - The supply UUID
 * @param {number} photoIndex - Photo index (1-based)
 * @param {string} extension - File extension (default 'jpg')
 */
export async function deleteSupplyPhoto(supplyId, photoIndex = 1, extension = 'jpg') {
  const supabase = await getSupabaseClient();

  if (!supabase) {
    throw new Error('Supabase client not available');
  }

  const filename = `${supplyId}-${photoIndex}.${extension}`;
  const filePath = `${FOLDER}/${filename}`;

  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .remove([filePath]);

    if (error) {
      requestLogger.error('Failed to delete supply photo', {
        error: error.message,
        supplyId,
        filePath
      });
      throw error;
    }

    requestLogger.info('Supply photo deleted', { supplyId, filePath });
    return true;

  } catch (error) {
    requestLogger.error('Photo deletion failed', {
      error: error.message,
      supplyId,
      photoIndex
    });
    throw error;
  }
}

/**
 * Upload an anchorage photo to Supabase Storage
 * @param {string} anchorageId - The anchorage UUID
 * @param {string} base64Data - Base64 data URL (data:image/jpeg;base64,...)
 * @param {number} photoIndex - Photo index (1-based, default 1)
 * @returns {Promise<string>} Public URL of uploaded photo
 */
export async function uploadAnchoragePhoto(anchorageId, base64Data, photoIndex = 1) {
  const supabase = await getSupabaseClient();

  if (!supabase) {
    throw new Error('Supabase client not available');
  }

  if (!anchorageId) {
    throw new Error('Anchorage ID is required');
  }

  if (!base64Data || !base64Data.startsWith('data:image/')) {
    throw new Error('Invalid base64 image data');
  }

  try {
    // Extract mime type and base64 content
    const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 data URL format');
    }

    const imageType = matches[1]; // jpeg, png, etc.
    const base64Content = matches[2];

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Content, 'base64');

    // Generate filename: {anchorage_id}-{index}.{ext}
    const extension = imageType === 'jpeg' ? 'jpg' : imageType;
    const filename = `${anchorageId}-${photoIndex}.${extension}`;
    const filePath = `${ANCHORAGE_FOLDER}/${filename}`;

    requestLogger.info('Uploading anchorage photo', {
      anchorageId,
      photoIndex,
      filename,
      filePath,
      fileSize: buffer.length,
      imageType
    });

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, buffer, {
        contentType: `image/${imageType}`,
        upsert: true // Allow overwriting if photo already exists
      });

    if (error) {
      requestLogger.error('Supabase Storage upload error', {
        error: error.message,
        code: error.code,
        anchorageId,
        filePath
      });
      throw new Error(`Failed to upload photo: ${error.message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    const publicUrl = urlData.publicUrl;

    requestLogger.info('Anchorage photo uploaded successfully', {
      anchorageId,
      photoIndex,
      filePath: data.path,
      publicUrl
    });

    return publicUrl;

  } catch (error) {
    requestLogger.error('Anchorage photo upload failed', {
      error: error.message,
      anchorageId,
      photoIndex
    });
    throw error;
  }
}

export default {
  uploadSupplyPhoto,
  deleteSupplyPhoto,
  uploadAnchoragePhoto
};
