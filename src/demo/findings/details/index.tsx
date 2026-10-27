import type { ComponentType } from 'react'
import type { FindingDetail } from '@/lib/runTypes'
import CreatorDetailView from './creator'
import DescriptionDetailView from './description'
import DmcaDetailView from './dmca'
import HackDetailView from './hack'
import SentimentDetailView from './sentiment'
import type { DetailViewProps } from './types'

/** finding.detail.kind -> the view for its expanded row. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const detailViews: Record<FindingDetail['kind'], ComponentType<DetailViewProps<any>>> = {
  hack: HackDetailView,
  dmca: DmcaDetailView,
  sentiment: SentimentDetailView,
  description: DescriptionDetailView,
  creator: CreatorDetailView,
}
