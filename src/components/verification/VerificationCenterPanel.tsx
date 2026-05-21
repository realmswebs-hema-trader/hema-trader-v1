import { useState } from 'react';
import {
  BadgeCheck,
  Camera,
  CheckCircle2,
  FileText,
  IdCard,
  Loader2,
  Phone,
  ShieldCheck,
  Truck,
  Upload
} from 'lucide-react';

import {
  GovernmentIdType,
  confirmPhoneOtp,
  requestPhoneOtp,
  submitDriverVerification,
  submitIdentityVerification
} from '../../services/verificationService';

interface VerificationCenterPanelProps {
  userId: string;
  profile: any;
  isOwnProfile: boolean;
}

export default function VerificationCenterPanel({
  userId,
  profile,
  isOwnProfile
}: VerificationCenterPanelProps) {
  const [phoneNumber, setPhoneNumber] = useState(profile?.phoneNumber || '');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [governmentIdType, setGovernmentIdType] = useState<GovernmentIdType>('national_id');
  const [governmentIdFile, setGovernmentIdFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [driverLicenseFile, setDriverLicenseFile] = useState<File | null>(null);
  const [vehiclePhotoFile, setVehiclePhotoFile] = useState<File | null>(null);
  const [vehicleType, setVehicleType] = useState(profile?.vehicleType || 'motorbike');
  const [vehiclePlate, setVehiclePlate] = useState(profile?.vehiclePlate || '');
  const [deliveryZones, setDeliveryZones] = useState('');
  const [loadingAction, setLoadingAction] = useState('');
  const [message, setMessage] = useState('');

  const isDriver = Array.isArray(profile?.roles) && profile.roles.includes('driver');
  const identityVerified =
    profile?.identityVerified || profile?.verificationStatus === 'verified';

  const sendOtp = async () => {
    if (!phoneNumber.trim()) return;

    setLoadingAction('phone');
    setMessage('');

    try {
      await requestPhoneOtp(phoneNumber.trim());
      setOtpSent(true);
      setMessage('OTP sent. Check your phone.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not send OTP.');
    } finally {
      setLoadingAction('');
    }
  };

  const verifyOtp = async () => {
    if (!phoneNumber.trim() || !otp.trim()) return;

    setLoadingAction('otp');
    setMessage('');

    try {
      await confirmPhoneOtp({
        userId,
        phoneNumber: phoneNumber.trim(),
        otp: otp.trim()
      });

      setMessage('Phone verified successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not verify OTP.');
    } finally {
      setLoadingAction('');
    }
  };

  const submitIdentity = async () => {
    if (!governmentIdFile || !selfieFile) return;

    setLoadingAction('identity');
    setMessage('');

    try {
      await submitIdentityVerification({
        userId,
        governmentIdType,
        governmentIdFile,
        selfieFile
      });

      setGovernmentIdFile(null);
      setSelfieFile(null);
      setMessage('Identity submitted. Our team will review it soon.');
    } catch (error) {
      setMessage('Could not submit identity documents.');
    } finally {
      setLoadingAction('');
    }
  };

  const submitDriver = async () => {
    if (!driverLicenseFile || !vehicleType) return;

    setLoadingAction('driver');
    setMessage('');

    try {
      await submitDriverVerification({
        userId,
        driverLicenseFile,
        vehiclePhotoFile: vehiclePhotoFile || undefined,
        vehicleType,
        vehiclePlate,
        deliveryZones: deliveryZones
          .split(',')
          .map(zone => zone.trim())
          .filter(Boolean)
      });

      setDriverLicenseFile(null);
      setVehiclePhotoFile(null);
      setMessage('Driver verification submitted. Our team will review it soon.');
    } catch (error) {
      setMessage('Could not submit driver verification.');
    } finally {
      setLoadingAction('');
    }
  };

  return (
    <section className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-6 shadow-2xl sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-amber-500" />
            <h3 className="font-serif text-2xl text-white">Local Trust Verification</h3>
          </div>
          <p className="mt-2 max-w-2xl text-[10px] uppercase leading-relaxed tracking-widest text-slate-500">
            Simple verification for farmers, livestock sellers, market traders, riders, and local merchants. No business license required.
          </p>
        </div>

        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-center">
          <p className="text-[8px] font-black uppercase tracking-widest text-amber-500">
            Verification Score
          </p>
          <p className="font-serif text-2xl text-white">
            {profile?.verificationScore || 0}%
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          {
            label: 'Email',
            verified: profile?.emailVerified !== false,
            icon: BadgeCheck
          },
          {
            label: 'Phone',
            verified: profile?.phoneVerified,
            icon: Phone
          },
          {
            label: 'Identity',
            verified: identityVerified,
            icon: IdCard
          },
          {
            label: 'Driver',
            verified: profile?.driverVerified,
            icon: Truck
          },
          {
            label: 'Elite',
            verified:
              (profile?.trustScore || 0) >= 96 &&
              profile?.phoneVerified &&
              identityVerified,
            icon: CheckCircle2
          }
        ].map(item => (
          <div
            key={item.label}
            className={`rounded-2xl border p-4 ${
              item.verified
                ? 'border-green-500/20 bg-green-500/10'
                : 'border-white/5 bg-black/30'
            }`}
          >
            <item.icon
              className={`mb-3 h-5 w-5 ${
                item.verified ? 'text-green-500' : 'text-slate-600'
              }`}
            />
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
              {item.label}
            </p>
            <p
              className={`mt-1 text-[9px] font-black uppercase tracking-widest ${
                item.verified ? 'text-green-500' : 'text-slate-600'
              }`}
            >
              {item.verified ? 'Verified' : 'Optional'}
            </p>
          </div>
        ))}
      </div>

      {!isOwnProfile ? (
        <p className="rounded-2xl border border-white/5 bg-black/30 p-5 text-[10px] uppercase leading-relaxed tracking-widest text-slate-500">
          Verification improves trust, but unverified traders can still buy, sell, chat, follow, and participate in escrow trades.
        </p>
      ) : (
        <div className="space-y-5">
          <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
            <div className="mb-4 flex items-center gap-3">
              <Phone className="h-5 w-5 text-amber-500" />
              <div>
                <p className="font-serif text-lg text-white">Phone Verification</p>
                <p className="text-[9px] uppercase tracking-widest text-slate-500">
                  Most important trust signal for local trading.
                </p>
              </div>
            </div>

            {profile?.phoneVerified ? (
              <div className="flex items-center gap-3 rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-green-500">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-[10px] font-black uppercase tracking-widest">
                  Phone Verified
                </span>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <input
                  value={phoneNumber}
                  onChange={event => setPhoneNumber(event.target.value)}
                  placeholder="+237 6XX XXX XXX"
                  className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none"
                />
                <button
                  onClick={sendOtp}
                  disabled={loadingAction === 'phone' || !phoneNumber.trim()}
                  className="rounded-xl bg-white px-5 py-4 text-[10px] font-black uppercase tracking-widest text-black hover:bg-amber-500 disabled:opacity-50"
                >
                  {loadingAction === 'phone' ? 'Sending...' : 'Send OTP'}
                </button>

                {otpSent && (
                  <>
                    <input
                      value={otp}
                      onChange={event => setOtp(event.target.value)}
                      placeholder="Enter OTP"
                      className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none"
                    />
                    <button
                      onClick={verifyOtp}
                      disabled={loadingAction === 'otp' || !otp.trim()}
                      className="rounded-xl bg-amber-500 px-5 py-4 text-[10px] font-black uppercase tracking-widest text-black hover:bg-amber-400 disabled:opacity-50"
                    >
                      {loadingAction === 'otp' ? 'Checking...' : 'Verify'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
            <div className="mb-4 flex items-center gap-3">
              <IdCard className="h-5 w-5 text-amber-500" />
              <div>
                <p className="font-serif text-lg text-white">Identity Verification</p>
                <p className="text-[9px] uppercase tracking-widest text-slate-500">
                  National ID, voter card, passport, or driver license plus selfie.
                </p>
              </div>
            </div>

            {identityVerified ? (
              <div className="flex items-center gap-3 rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-green-500">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-[10px] font-black uppercase tracking-widest">
                  Identity Verified
                </span>
              </div>
            ) : profile?.identityVerificationStatus === 'pending' ||
              profile?.verificationStatus === 'pending' ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-[10px] font-black uppercase tracking-widest text-amber-500">
                Identity review in progress
              </div>
            ) : (
              <div className="space-y-3">
                <select
                  value={governmentIdType}
                  onChange={event => setGovernmentIdType(event.target.value as GovernmentIdType)}
                  className="w-full rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none"
                >
                  <option value="national_id">National ID</option>
                  <option value="voter_card">Voter Card</option>
                  <option value="passport">Passport</option>
                  <option value="driver_license">Driver License</option>
                </select>

                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-slate-400 hover:border-amber-500/40">
                  <span className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-amber-500" />
                    {governmentIdFile?.name || 'Upload ID document'}
                  </span>
                  <Upload className="h-4 w-4" />
                  <input
                    hidden
                    type="file"
                    accept="image/*"
                    onChange={event => setGovernmentIdFile(event.target.files?.[0] || null)}
                  />
                </label>

                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-slate-400 hover:border-amber-500/40">
                  <span className="flex items-center gap-3">
                    <Camera className="h-5 w-5 text-amber-500" />
                    {selfieFile?.name || 'Upload selfie photo'}
                  </span>
                  <Upload className="h-4 w-4" />
                  <input
                    hidden
                    type="file"
                    accept="image/*"
                    onChange={event => setSelfieFile(event.target.files?.[0] || null)}
                  />
                </label>

                <button
                  onClick={submitIdentity}
                  disabled={!governmentIdFile || !selfieFile || loadingAction === 'identity'}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-widest text-black hover:bg-amber-400 disabled:opacity-50"
                >
                  {loadingAction === 'identity' && <Loader2 className="h-4 w-4 animate-spin" />}
                  Submit Identity
                </button>
              </div>
            )}
          </div>

          {isDriver && (
            <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
              <div className="mb-4 flex items-center gap-3">
                <Truck className="h-5 w-5 text-green-500" />
                <div>
                  <p className="font-serif text-lg text-white">Driver Verification</p>
                  <p className="text-[9px] uppercase tracking-widest text-slate-500">
                    For delivery riders and transport partners.
                  </p>
                </div>
              </div>

              {profile?.driverVerified ? (
                <div className="flex items-center gap-3 rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-green-500">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    Driver Verified
                  </span>
                </div>
              ) : profile?.driverVerificationStatus === 'pending' ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-[10px] font-black uppercase tracking-widest text-amber-500">
                  Driver review in progress
                </div>
              ) : (
                <div className="space-y-3">
                  <select
                    value={vehicleType}
                    onChange={event => setVehicleType(event.target.value)}
                    className="w-full rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none"
                  >
                    <option value="motorbike">Motorbike / Scooter</option>
                    <option value="car">Car</option>
                    <option value="van">Van</option>
                    <option value="truck">Truck</option>
                  </select>

                  <input
                    value={vehiclePlate}
                    onChange={event => setVehiclePlate(event.target.value)}
                    placeholder="Vehicle plate or identifier"
                    className="w-full rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none"
                  />

                  <input
                    value={deliveryZones}
                    onChange={event => setDeliveryZones(event.target.value)}
                    placeholder="Delivery zones, comma separated"
                    className="w-full rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none"
                  />

                  <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-slate-400 hover:border-amber-500/40">
                    <span className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-amber-500" />
                      {driverLicenseFile?.name || 'Upload driver license'}
                    </span>
                    <Upload className="h-4 w-4" />
                    <input
                      hidden
                      type="file"
                      accept="image/*"
                      onChange={event => setDriverLicenseFile(event.target.files?.[0] || null)}
                    />
                  </label>

                  <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-slate-400 hover:border-amber-500/40">
                    <span className="flex items-center gap-3">
                      <Truck className="h-5 w-5 text-green-500" />
                      {vehiclePhotoFile?.name || 'Upload vehicle photo optional'}
                    </span>
                    <Upload className="h-4 w-4" />
                    <input
                      hidden
                      type="file"
                      accept="image/*"
                      onChange={event => setVehiclePhotoFile(event.target.files?.[0] || null)}
                    />
                  </label>

                  <button
                    onClick={submitDriver}
                    disabled={!driverLicenseFile || loadingAction === 'driver'}
                    className="flex w-full items-center justify-center gap-3 rounded-xl bg-green-500 py-4 text-[10px] font-black uppercase tracking-widest text-black hover:bg-green-400 disabled:opacity-50"
                  >
                    {loadingAction === 'driver' && <Loader2 className="h-4 w-4 animate-spin" />}
                    Submit Driver Verification
                  </button>
                </div>
              )}
            </div>
          )}

          {message && (
            <p className="rounded-xl border border-white/5 bg-black/40 p-4 text-center text-[10px] font-black uppercase tracking-widest text-amber-500">
              {message}
            </p>
          )}

          <p className="rounded-2xl border border-white/5 bg-black/30 p-5 text-[10px] uppercase leading-relaxed tracking-widest text-slate-500">
            You can still buy, sell, chat, follow, hire drivers, and use escrow without full verification. Verification simply increases trust and visibility.
          </p>
        </div>
      )}
    </section>
  );
}
