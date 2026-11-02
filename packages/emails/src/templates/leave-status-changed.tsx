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

export interface LeaveStatusChangedEmailProps {
  employeeName: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  status: "approved" | "rejected";
  decisionComment?: string;
  dashboardUrl: string;
}

export function LeaveStatusChangedEmail({
  employeeName,
  leaveTypeName,
  startDate,
  endDate,
  status,
  decisionComment,
  dashboardUrl,
}: LeaveStatusChangedEmailProps) {
  const isApproved = status === "approved";
  const statusColor = isApproved ? "#16a34a" : "#dc2626";
  const title = isApproved
    ? "Leave Request Approved"
    : "Leave Request Rejected";

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
          <Heading style={{ fontSize: "20px", color: statusColor }}>
            {title}
          </Heading>
          <Text style={{ fontSize: "14px", color: "#4b5563" }}>
            Hello {employeeName},
          </Text>
          <Text style={{ fontSize: "14px", color: "#4b5563" }}>
            Your request for <strong>{leaveTypeName}</strong> from {startDate}{" "}
            to {endDate} has been{" "}
            <strong style={{ color: statusColor }}>{status}</strong>.
          </Text>
          {decisionComment && (
            <Text
              style={{
                fontSize: "14px",
                color: "#4b5563",
                fontStyle: "italic",
              }}
            >
              Manager notes: &ldquo;{decisionComment}&rdquo;
            </Text>
          )}
          <div style={{ marginTop: "20px" }}>
            <Link
              href={dashboardUrl}
              style={{
                backgroundColor: "#2563eb",
                color: "#ffffff",
                padding: "10px 18px",
                borderRadius: "6px",
                textDecoration: "none",
                display: "inline-block",
                fontWeight: 500,
              }}
            >
              View in LibreHR
            </Link>
          </div>
        </Container>
      </Body>
    </Html>
  );
}
