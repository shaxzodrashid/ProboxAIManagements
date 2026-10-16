import { ApiProperty } from "@nestjs/swagger";

/** No account/workspace selector or other request input is accepted. */
export class SelfTelegramLinkQueryDto {}

export class SelfTelegramLinkResponseDto {
  @ApiProperty({
    enum: ["NOT_LINKED", "LINKED", "INCOMPLETE"],
    description:
      "Stored contact-verification record only. LINKED means Telegram user ID, chat ID and verification timestamp are all present; NOT_LINKED means all absent; INCOMPLETE means partial historical data. Does not prove bot reachability, current Telegram ownership, OTP delivery or recovery eligibility.",
  })
  linkState!: "NOT_LINKED" | "LINKED" | "INCOMPLETE";
}
