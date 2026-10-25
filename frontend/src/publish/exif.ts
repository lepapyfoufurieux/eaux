import exifr from "exifr";
import type { LatLng } from "../types";

export interface PhotoMetadata {
  /** Null when the photo has no position: phones drop it when a photo goes through a messaging app. */
  position: LatLng | null;
  takenAt: Date;
}

/** Read position and date from the photo, falling back to the file date. */
export async function readMetadata(file: File): Promise<PhotoMetadata> {
  const fallback = { position: null, takenAt: new Date(file.lastModified) };
  try {
    const gps = await exifr.gps(file);
    const tags = await exifr.parse(file, ["DateTimeOriginal"]);
    const takenAt = tags?.DateTimeOriginal instanceof Date ? tags.DateTimeOriginal : fallback.takenAt;
    const position = gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude) ? { lat: gps.latitude, lng: gps.longitude } : null;
    return { position, takenAt };
  } catch {
    return fallback;
  }
}
