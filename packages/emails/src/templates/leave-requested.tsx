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

export interface LeaveRequestedEmailProps {
  employeeName: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  reviewUrl: string;
}

export function LeaveRequestedEmail({
  employeeName,
  leaveTypeName,
  startDate,
  endDate,
  workingDays,
  reviewUrl,
}: LeaveRequestedEmailProps) {
  return (
    <Html>
      <Head />
      <Body
        style={{
          fontFamily: "sans-serif",
          backgroundColor: "#f9fafb",
          padding: "20px",
        }}
      >
        <Container
          style={{
            backgroundColor: "#ffffff",
            padding: "24px",
            borderRadius: "8px",
          }}
        >
          <Heading style={{ fontSize: "20px", color: "#111827" }}>
            New Leave Request Submitted
          </Heading>
          <Text style={{ fontSize: "14px", color: "#4b5563" }}>
            <strong>{employeeName}</strong> has requested {workingDays} day(s)
            of <strong>{leaveTypeName}</strong>.
          </Text>
          <Text style={{ fontSize: "14px", color: "#4b5563" }}>
            Period: {startDate} to {endDate}
          </Text>
          <div style={{ marginTop: "20px" }}>
            <Link
              href={reviewUrl}
              style={{
                backgroundColor: "#2563eb",
                color: "#ffffff",
                padding: "10px 18px",
                borderRadius: "6px",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Review Leave Request
            </Link>
          </div>
        </Container>
      </Body>
    </Html>
  );
}

export default LeaveRequestedEmail;
