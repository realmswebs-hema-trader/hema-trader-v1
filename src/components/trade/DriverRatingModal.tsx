import ReviewModal from '../reviews/ReviewModal';

interface DriverRatingModalProps {
  tradeId: string;
  driverId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function DriverRatingModal({
  tradeId,
  driverId,
  onClose,
  onSuccess
}: DriverRatingModalProps) {
  return (
    <ReviewModal
      tradeId={tradeId}
      reviewedUserId={driverId}
      initialCategory="driver"
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}
