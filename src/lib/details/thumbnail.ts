/* Detail payload for one gallery thumbnail the Thumbnail Daemon's watcher reports. Owned by the server-infra worker
   (server/watch-thumbnails.ts produces it); the findings-core worker renders it. JSON-serialisable. */
export interface ThumbnailDetail {
  kind: 'thumbnail'
  /** Roblox image asset id (stable). */
  thumbId: string
  /** tr.rbxcdn.com URL at 768x432. */
  url: string
  /** True when this id was not in the gallery at the previous check. */
  isNew: boolean
  /** ISO time the watcher first saw this id. */
  firstSeen: string
  /** Position in the gallery, 1-based. */
  position: number
}
