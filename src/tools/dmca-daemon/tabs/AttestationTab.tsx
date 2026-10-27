import { useState } from 'react'
import { FileSignature, ShieldOff } from 'lucide-react'
import { Badge, Button, Dialog, KeyValue, useToast } from '@/components/ui'
import { ATTESTATION, type Dataset } from '../data'

export function AttestationTab({ data, revoked, onRevokedChange }: { data: Dataset; revoked: boolean; onRevokedChange: (v: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const families = data.families.filter((f) => f.approvedImages >= 10).map((f) => f.name)
  return (
    <div className="grid gap-24 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2">
        <div className="flex flex-wrap items-center gap-12">
          <h3 className="text-title font-bold text-ink">Standing good-faith attestation</h3>
          {revoked ? (
            <Badge tone="danger" dot pulse={false}>
              Revoked
            </Badge>
          ) : (
            <Badge tone="live" dot pulse={false}>
              In force
            </Badge>
          )}
        </div>
        <dl className="mt-16 max-w-prose">
          <KeyValue label="Signer, full legal name" value={ATTESTATION.signer} />
          <KeyValue label="Role" value={ATTESTATION.title} />
          <KeyValue label="Signed" value={ATTESTATION.signedAt} />
          <KeyValue label="Scope" value="Exact hash only (sha256, byte-identical)" />
          <KeyValue label="Excluded" value="Perceptual, partial and licensed matches" />
          <KeyValue label="Families covered" value={families.join(', ')} />
        </dl>
        <p className="mt-16 max-w-prose text-label text-muted">
          {ATTESTATION.scope} A perceptual match never enters the auto-file lane, whatever its score; it waits for a reviewer, who signs that filing separately.
        </p>
        <blockquote className="mt-16 max-w-prose rounded-8 bg-raised p-16 text-label text-ink">
          "I have a good faith belief that use of the exact copies of the registered assets described above is not authorized by the copyright owner, its agent, or the law. The
          information in each notice is accurate, and under penalty of perjury, I am authorized to act on behalf of the owner of the exclusive rights."
        </blockquote>
      </div>
      <div className="min-w-0 rounded-8 border border-line p-16">
        <h3 className="text-label font-medium text-ink">{revoked ? 'Auto-file is paused' : 'Revoking pauses auto-file'}</h3>
        <p className="mt-8 text-micro text-muted">
          {revoked
            ? 'Exact matches now queue for human review like lookalikes. Requests already submitted stay with Roblox; there are no edits after submit.'
            : 'Exact matches would queue for human review until someone signs again. Submitted requests are not withdrawn.'}
        </p>
        {revoked ? (
          <Button
            size="sm"
            className="mt-16"
            icon={FileSignature}
            onClick={() => {
              onRevokedChange(false)
              toast.push({ title: 'Attestation signed again', description: `${ATTESTATION.signer}, exact hash only. Auto-file resumes on the next crawl.`, tone: 'ok' })
            }}
          >
            Sign again
          </Button>
        ) : (
          <Button size="sm" variant="danger" className="mt-16" icon={ShieldOff} onClick={() => setOpen(true)}>
            Revoke attestation
          </Button>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Revoke the standing attestation?"
        description={`Signed by ${ATTESTATION.signer} on ${ATTESTATION.signedAt}.`}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Keep it</Button>
            <Button
              variant="danger"
              icon={ShieldOff}
              onClick={() => {
                onRevokedChange(true)
                setOpen(false)
                toast.push({ title: 'Attestation revoked', description: 'Auto-file is paused. Exact matches will wait for a reviewer.', tone: 'warn' })
              }}
            >
              Revoke attestation
            </Button>
          </>
        }
      >
        <p className="text-label text-muted">
          The daemon stops filing exact-hash matches on its own. {data.requestA} is already with Roblox and stays as submitted. You can sign again at any time.
        </p>
      </Dialog>
    </div>
  )
}
