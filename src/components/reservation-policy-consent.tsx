import Link from "next/link";
import { RESERVATION_POLICY_VERSION } from "@/lib/reservation-policy-version";

export function ReservationPolicyConsent() {
  return <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-mip-gray-700">
    <input type="checkbox" name="acknowledged_policies" value={RESERVATION_POLICY_VERSION}
      required className="mt-1.5 h-4 w-4 shrink-0" />
    <span>I agree to the <Link href="/reservations/terms" target="_blank" rel="noopener noreferrer"
      className="text-mip-purple underline">Reservations Terms of Use</Link> and acknowledge the{" "}
      <Link href="/reservations/privacy" target="_blank" rel="noopener noreferrer"
        className="text-mip-purple underline">Privacy Policy</Link> (opens in new tabs).</span>
  </label>;
}
