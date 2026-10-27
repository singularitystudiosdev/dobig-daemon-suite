import { useState } from 'react'
import { cn } from '@/lib/cn'
import { heroSrc, type ExampleHeroImage } from '@/lib/example'

/* The picture on a tool's card: one or two real images from the game's world, each shown whole in a 16:9 frame. Two
   images sit side by side with their captions on them (for example 'Original' and 'A copy found'), uncropped so the
   comparison is honest. An image that fails to load leaves the quiet raised background, never a broken-image icon. */

function Pic({ image, label }: { image: ExampleHeroImage; label: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="relative aspect-video min-w-0 overflow-hidden bg-raised">
      {!failed && (
        <img
          src={heroSrc(image.url)}
          alt={image.caption}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {label && <span className="absolute bottom-8 left-8 rounded-full bg-canvas px-8 py-2 text-micro font-medium text-ink">{image.caption}</span>}
    </div>
  )
}

export function ToolHero({ images, className }: { images: ExampleHeroImage[]; className?: string }) {
  const shown = images.slice(0, 2)
  return (
    <div className={cn('grid w-full gap-2 overflow-hidden rounded-8 bg-raised', shown.length > 1 ? 'grid-cols-2' : 'grid-cols-1', className)}>
      {shown.map((img) => (
        <Pic key={img.url} image={img} label={shown.length > 1} />
      ))}
    </div>
  )
}
