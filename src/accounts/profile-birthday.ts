import { BadRequestException } from "@nestjs/common";
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";

export function validBirthDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(value + "T00:00:00.000Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function parseBirthDate(value: string): Date {
  if (!validBirthDate(value))
    throw new BadRequestException(
      "birthDate must be a real YYYY-MM-DD calendar date",
    );
  return new Date(value + "T00:00:00.000Z");
}
@ValidatorConstraint({ name: "birthDate", async: false })
export class BirthDateValidator implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return validBirthDate(value);
  }
  defaultMessage() {
    return "birthDate must be a real YYYY-MM-DD calendar date";
  }
}
