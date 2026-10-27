import { Badge, Table, Td, Th } from '@/components/ui'
import { kindIcon } from '../Stage'
import { shortHash, type Dataset } from '../data'

const MIN_IMAGES = 10

export function FamiliesTab({ data }: { data: Dataset }) {
  return (
    <div className="flex flex-col gap-24">
      <Table caption="IP families registered in Rights Manager">
        <thead>
          <tr>
            <Th>IP family</Th>
            <Th>Registered assets</Th>
            <Th numeric>Approved images</Th>
            <Th>Roblox-side matching</Th>
            <Th numeric>Matches this week</Th>
            <Th numeric>Filed this week</Th>
          </tr>
        </thead>
        <tbody>
          {data.families.map((f) => {
            const active = f.approvedImages >= MIN_IMAGES
            return (
              <tr key={f.name}>
                <Td className="font-medium">{f.name}</Td>
                <Td className="text-micro text-muted">
                  {f.images} images, {f.meshes} meshes, {f.audio} audio
                </Td>
                <Td numeric>{f.approvedImages}</Td>
                <Td>
                  <div className="flex flex-col items-start gap-4">
                    <Badge tone={active ? 'live' : 'warn'} dot pulse={false}>
                      {active ? 'Active' : 'Inactive'}
                    </Badge>
                    <span className="text-micro text-muted">
                      {active
                        ? `Family has ${f.approvedImages} approved images: Roblox-side matching active (10 or more required)`
                        : `${f.approvedImages} approved images: ${MIN_IMAGES - f.approvedImages} more needed for Roblox-side matching`}
                    </span>
                  </div>
                </Td>
                <Td numeric>{f.matchesThisWeek}</Td>
                <Td numeric>{f.filedThisWeek}</Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <div>
        <h3 className="text-label font-medium text-ink">Fingerprints in {data.families[0].name}</h3>
        <p className="mt-4 text-micro text-muted">Hashed from the asset-delivery record of each registered asset. Only the sha256 column can trigger an auto-file.</p>
        <Table caption="Registered asset fingerprints" className="mt-8">
          <thead>
            <tr>
              <Th>Asset</Th>
              <Th>Kind</Th>
              <Th numeric>assetId</Th>
              <Th>sha256</Th>
              <Th>Perceptual hash</Th>
              <Th>Family</Th>
            </tr>
          </thead>
          <tbody>
            {data.assets.map((a) => {
              const Icon = kindIcon[a.kind]
              return (
                <tr key={a.assetId}>
                  <Td className="font-medium">{a.name}</Td>
                  <Td>
                    <span className="flex items-center gap-8 text-micro">
                      <Icon aria-hidden className="size-16 text-muted" />
                      {a.kind}
                    </span>
                  </Td>
                  <Td numeric className="font-mono text-micro">
                    {a.assetId}
                  </Td>
                  <Td className="font-mono text-micro">{shortHash(a.sha256)}</Td>
                  <Td className="font-mono text-micro text-muted">{a.phash ?? (a.kind === 'audio' ? 'audio fingerprint' : 'mesh descriptor')}</Td>
                  <Td className="text-micro text-muted">{a.ipFamily}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </div>
    </div>
  )
}
