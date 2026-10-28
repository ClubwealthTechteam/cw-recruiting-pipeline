import CandidateView from '@/components/CandidateView';

export default async function Candidate({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CandidateView appId={decodeURIComponent(id)} />;
}
