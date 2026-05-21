import ReviewModal from '../reviews/ReviewModal';

interface RatingModalProps {
  tradeId: string;
  revieweeId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function RatingModal({
  tradeId,
  revieweeId,
  onClose,
  onSuccess
}: RatingModalProps) {
  return (
    <ReviewModal
      tradeId={tradeId}
      reviewedUserId={revieweeId}
      initialCategory="seller"
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}
