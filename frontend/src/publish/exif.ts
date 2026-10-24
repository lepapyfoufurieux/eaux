import exifr from "exifr";

export interface PhotoMetadata {
  lat: number;
  lng: number;
  takenAt: Date;
}

export type MetadataProblem = "no-position" | "unreadable";

/** Read position and date from the photo. Phones drop the position when a photo goes through a messaging app. */
export async function readMetadata(file: File): Promise<PhotoMetadata | MetadataProblem> {
  try {
    const gps = await exifr.gps(file);
    if (!gps || !Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude)) return "no-position";
    const tags = await exifr.parse(file, ["DateTimeOriginal"]);
    const takenAt = tags?.DateTimeOriginal instanceof Date ? tags.DateTimeOriginal : new Date(file.lastModified);
    return { lat: gps.latitude, lng: gps.longitude, takenAt };
  } catch {
    return "unreadable";
  }
}
