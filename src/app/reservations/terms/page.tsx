import { ReservationPolicyPage } from "@/components/reservation-policy-page";
import { reservationTerms } from "@/content/reservations-policies";
export const metadata = { title: "Reservations Terms of Use | MIP" };
export default function TermsPage() {
  return <ReservationPolicyPage kind="terms" content={reservationTerms} />;
}
