import type { FlowLevel } from "./domain/flow";

/** A reading as sent by GET /api/readings (dates already parsed). */
export interface Reading {
  id: string;
  takenAt: Date;
  flowLevel: FlowLevel;
  comment: string;
  authorName: string;
  /** Station code (S01…), or null when the photo is more than 400 m from every station. */
  station: string | null;
  lat: number;
  lng: number;
  photo: string;
  thumbnail: string;
}

export interface Station {
  code: string;
  name: string;
  watercourse: string | null;
  watercourseId: number | null;
  /** Position along its watercourse, upstream first. */
  order: number;
  lat: number;
  lng: number;
}

export interface Watercourse {
  id: number;
  name: string;
  tributaryOf: number | null;
  /** Where the confluence sits along the parent, 0 = upstream end, 1 = downstream end. */
  confluencePosition: number | null;
}

export interface LatLng {
  lat: number;
  lng: number;
}
