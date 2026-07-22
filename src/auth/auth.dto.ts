import { IsString, Matches } from "class-validator";

export class RequestOtpDto {
  @IsString() @Matches(/^\+[1-9]\d{7,14}$/) phoneNumber!: string;
}
export class VerifyOtpDto extends RequestOtpDto {
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
