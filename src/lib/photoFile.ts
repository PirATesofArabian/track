// Which files the progress-photo picker takes. Whatever is picked is re-saved as a JPEG (Photos.tsx).
// "image/*" and not a list naming HEIC: as far as I know, iPhone Safari converts to JPEG for "image/*" but hands over the raw HEIC when HEIC is named. Not tried on a phone.
export const PHOTO_ACCEPT = 'image/*'

/** Why a file cannot be used as a progress photo, or null if it can. A phone often gives HEIC an empty type, so the file name counts too. */
export function photoProblem(f: { name: string; type: string }): string | null {
  const type = f.type.toLowerCase(), name = f.name.toLowerCase()
  if (type.startsWith('video/') || /\.(mov|mp4|m4v)$/.test(name)) return 'That is a video, such as the motion part of a Live Photo. Pick the photo itself: only the still picture is kept, without the movement.'
  if (/^image\/(jpeg|png|heic|heif)$/.test(type) || /\.(jpe?g|png|heic|heif)$/.test(name)) return null
  return 'Use a JPEG, PNG or iPhone (HEIC) photo.'
}
export const isHeic = (f: { name: string; type: string }) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)

const MAX_SIDE = 1440

/** Same pipeline as theirs: respect EXIF orientation, cap the longest side at 1440px, JPEG at 0.85. JPEG and PNG come out as JPEG (tested in Chrome); HEIC does too wherever the browser can decode it (Chrome cannot). */
export async function resize(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height) // a PNG with see-through parts would turn black as a JPEG
  g.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close?.()
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.85))
}
