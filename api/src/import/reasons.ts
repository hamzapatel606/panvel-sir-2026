export const ASDD_REASON_CODES = {
	"Already enrolled": "ALREADY_ENROLLED",
	"Death": "DEATH",
	"EF Refused": "EF_REFUSED",
	"Permanently Shifted": "PERMANENTLY_SHIFTED",
	"Untraceable/Absent": "UNTRACEABLE_ABSENT",
} as const;

export type AsddReasonCode =
	(typeof ASDD_REASON_CODES)[keyof typeof ASDD_REASON_CODES];

export function getAsddReasonCode(
	reason: string,
): string | null {
	return ASDD_REASON_CODES[
		reason as keyof typeof ASDD_REASON_CODES
	] ?? null;
}
