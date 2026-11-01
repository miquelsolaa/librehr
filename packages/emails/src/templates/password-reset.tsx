import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Heading,
  Text,
  Link,
} from "@react-email/components";

export interface PasswordResetEmailProps {
  resetUrl: string;
  locale?: string;
}

export function PasswordResetEmail({ resetUrl }: PasswordResetEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "sans-serif" }}>
        <Container>
          <Heading>Reset your OpenHR password</Heading>
          <Text>
            Click the link below to reset your password. This link expires in 1
            hour.
          </Text>
          <Link href={resetUrl}>Reset Password</Link>
        </Container>
      </Body>
    </Html>
  );
}

export default PasswordResetEmail;
