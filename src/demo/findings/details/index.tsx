import type { ComponentType } from 'react'
import type { FindingDetail } from '@/lib/runTypes'
import CreatorDetailView from './creator'
import DescriptionDetailView from './description'
import DmcaDetailView from './dmca'
import HackDetailView from './hack'
import PulseDetailView from './pulse'
import RankDetailView from './rank'
import ContentCreatorDetailView from './content-creator'
import SentimentDetailView from './sentiment'
import ThumbnailDetailView from './thumbnail'
import type { DetailViewProps } from './types'

/** finding.detail.kind -> the view for its expanded row. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const detailViews: Record<FindingDetail['kind'], ComponentType<DetailViewProps<any>>> = {
  hack: HackDetailView,
  dmca: DmcaDetailView,
  sentiment: SentimentDetailView,
  description: DescriptionDetailView,
  creator: CreatorDetailView,
  thumbnail: ThumbnailDetailView,
  rank: RankDetailView,
  'content-creator': ContentCreatorDetailView,
  pulse: PulseDetailView,
}
