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

export interface InviteEmailProps {
  inviteUrl: string;
  orgName: string;
  locale?: string;
}

export function InviteEmail({ inviteUrl, orgName }: InviteEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "sans-serif" }}>
        <Container>
          <Heading>Welcome to {orgName} on LibreHR</Heading>
          <Text>You have been invited to join {orgName}.</Text>
          <Link href={inviteUrl}>Accept Invitation</Link>
        </Container>
      </Body>
    </Html>
  );
}

export default InviteEmail;
