import { ReservationPolicyPage } from "@/components/reservation-policy-page";
import { privacyPolicy } from "@/content/reservations-policies";
export const metadata = { title: "Reservations Privacy Policy | MIP" };
export default function PrivacyPage() {
  return <ReservationPolicyPage kind="privacy" content={privacyPolicy} />;
}
