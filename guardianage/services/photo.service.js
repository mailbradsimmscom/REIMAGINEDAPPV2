/**
 * Guardianage Photo Service
 * Upload photos to Supabase Storage, resolve public URLs.
 */

import { getSupabaseClient } from '../repositories/supabase.js';

const BUCKET = 'documents';
const TASK_PHOTO_FOLDER = 'guardianage/task-photos';
const RECEIPT_PHOTO_FOLDER = 'guardianage/receipt-photos';

export async function uploadTaskPhoto({ taskId, file, userId }) {
  const supabase = await getSupabaseClient();

  const ext = file.originalname.split('.').pop()?.toLowerCase() || 'jpg';
  const filename = `${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const storagePath = `${TASK_PHOTO_FOLDER}/${filename}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // Save metadata
  const { data: photo, error: dbError } = await supabase
    .from('guardianage_task_photos')
    .insert({
      task_id: taskId,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      original_filename: file.originalname,
      mime_type: file.mimetype,
      file_size_bytes: file.size,
      uploaded_by_user_id: userId,
    })
    .select()
    .single();

  if (dbError) throw new Error(`Failed to save photo metadata: ${dbError.message}`);

  // Create task event
  await supabase
    .from('guardianage_task_events')
    .insert({
      task_id: taskId,
      actor_user_id: userId,
      event_type: 'photo_added',
      event_metadata_json: { photo_id: photo.id, filename },
    });

  return photo;
}

export async function uploadReceiptPhoto({ supplyId, file, userId }) {
  const supabase = await getSupabaseClient();

  const ext = file.originalname.split('.').pop()?.toLowerCase() || 'jpg';
  const filename = `${supplyId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const storagePath = `${RECEIPT_PHOTO_FOLDER}/${filename}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: receipt, error: dbError } = await supabase
    .from('guardianage_month_supply_receipts')
    .insert({
      month_supply_id: supplyId,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      original_filename: file.originalname,
      mime_type: file.mimetype,
      file_size_bytes: file.size,
      uploaded_by_user_id: userId,
    })
    .select()
    .single();

  if (dbError) throw new Error(`Failed to save receipt metadata: ${dbError.message}`);

  // Audit log
  await supabase
    .from('guardianage_audit_log')
    .insert({
      actor_user_id: userId,
      entity_type: 'receipt',
      entity_id: receipt.id,
      action_type: 'receipt_uploaded',
      summary: `Receipt uploaded for supply ${supplyId}`,
    });

  return receipt;
}

export function resolvePublicUrl(storageBucket, storagePath) {
  // Construct Supabase public URL
  const supabaseUrl = process.env.SUPABASE_URL;
  return `${supabaseUrl}/storage/v1/object/public/${storageBucket}/${storagePath}`;
}

export async function softDeletePhoto(photoId, userId) {
  const supabase = await getSupabaseClient();

  const { data: photo, error } = await supabase
    .from('guardianage_task_photos')
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: userId,
    })
    .eq('id', photoId)
    .select()
    .single();

  if (error) throw new Error(`Failed to delete photo: ${error.message}`);

  // Create task event
  await supabase
    .from('guardianage_task_events')
    .insert({
      task_id: photo.task_id,
      actor_user_id: userId,
      event_type: 'photo_removed',
      event_metadata_json: { photo_id: photoId },
    });

  return photo;
}
