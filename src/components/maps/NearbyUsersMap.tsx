import { useMemo } from 'react';

import MarketplaceMap from './MarketplaceMap';
import {
  filterWithinDistance,
  sortByDistance,
  type GeoPoint
} from '../../utils/geoUtils';

interface NearbyUsersMapProps {
  users: any[];
  currentLocation?: GeoPoint | null;
  radiusKm?: number;
  className?: string;
  onRequestLocation?: () => void;
}

export default function NearbyUsersMap({
  users,
  currentLocation,
  radiusKm = 50,
  className,
  onRequestLocation
}: NearbyUsersMapProps) {
  const nearbyUsers = useMemo(() => {
    const filtered = filterWithinDistance(users, currentLocation, radiusKm);
    return sortByDistance(filtered, currentLocation);
  }, [users, currentLocation, radiusKm]);

  return (
    <MarketplaceMap
      users={nearbyUsers}
      currentLocation={currentLocation}
      radiusKm={radiusKm}
      className={className}
      onRequestLocation={onRequestLocation}
    />
  );
}
