import { createClient } from "@/lib/supabase/client";

export async function uploadToBucket(bucket: string, path: string, blob: Blob, contentType = "image/jpeg"): Promise<string> {
  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
