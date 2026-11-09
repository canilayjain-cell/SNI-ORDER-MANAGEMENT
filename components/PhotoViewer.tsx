"use client";
import { useState } from "react";

export function usePhotoViewer() {
  const [photos, setPhotos] = useState<string[] | null>(null);

  function open(p: string[] | undefined) {
    if (p && p.length) setPhotos(p);
  }
  function close() {
    setPhotos(null);
  }

  const viewer = photos ? (
    <div className="photo-viewer open" onClick={close}>
      <button className="photo-viewer-close" aria-label="Close photo">✕</button>
      <div className={`photo-viewer-strip ${photos.length === 1 ? "single" : ""}`}>
        {photos.map((src, i) => (
          <img key={i} src={src} alt={`Photo ${i + 1}`} />
        ))}
      </div>
    </div>
  ) : null;

  return { open, viewer };
}
