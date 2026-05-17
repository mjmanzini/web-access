import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { T } from "../lib/theme";

export default function TermsOfServiceScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Terms of Service</Text>
      <Text style={styles.updated}>Last updated: June 2025</Text>

      <Text style={styles.sectionTitle}>1. Acceptance of Terms</Text>
      <Text style={styles.body}>
        By downloading, installing, or using Khuloh ("the App"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the App. Khuloh is operated by Khuloh (Pty) Ltd, a company registered in the Republic of South Africa.
      </Text>

      <Text style={styles.sectionTitle}>2. Eligibility</Text>
      <Text style={styles.body}>
        You must be at least 18 years of age to use Khuloh. By using the App, you represent and warrant that you are of legal age to form a binding contract and meet the eligibility requirements. Khuloh performs identity verification through our liveness detection system to ensure authentic users.
      </Text>

      <Text style={styles.sectionTitle}>3. Account Registration & Verification</Text>
      <Text style={styles.body}>
        You must provide a valid South African mobile number for registration. You will verify your identity through our AI-powered liveness check. You are responsible for maintaining the confidentiality of your account. You may not create accounts on behalf of others, transfer your account, or use the App if your account has been suspended or banned.
      </Text>

      <Text style={styles.sectionTitle}>4. User Conduct</Text>
      <Text style={styles.body}>
        You agree not to:{"\n"}
        • Engage in harassment, hate speech, or threatening behaviour{"\n"}
        • Create fraudulent profiles or impersonate others{"\n"}
        • Send unsolicited commercial messages or spam{"\n"}
        • Share explicit content without mutual consent{"\n"}
        • Attempt to manipulate the Vibe Points economy{"\n"}
        • Use the App for any illegal purpose{"\n"}
        • Circumvent safety features or shadow-ban protections{"\n"}{"\n"}
        Violations may result in shadow-banning, account suspension, or permanent removal.
      </Text>

      <Text style={styles.sectionTitle}>5. Safety Features & Trust System</Text>
      <Text style={styles.body}>
        Khuloh provides safety tools including Scam Shield (AI message scanning), Trust Scores, Zone Guardians, Emergency Contacts, and Safety Check-Ins. While we strive to create a safe environment, we cannot guarantee the identity, behaviour, or intentions of other users. Always exercise caution when meeting people in person. Use our Safe-Spots — verified partner venues — for first meetings.
      </Text>

      <Text style={styles.sectionTitle}>6. Vibe Economy & Virtual Currency</Text>
      <Text style={styles.body}>
        Vibe Points are a virtual, non-transferable currency earned through app activities. Points have no monetary value and cannot be exchanged for cash. Khuloh reserves the right to modify point values, earning rates, and spending costs at any time. Ghost Mode, Shouts, and other premium features require Vibe Points.
      </Text>

      <Text style={styles.sectionTitle}>7. Content Ownership</Text>
      <Text style={styles.body}>
        You retain ownership of content you create and share on Khuloh. By posting content, you grant Khuloh a non-exclusive, royalty-free licence to use, display, and distribute that content within the App for the purpose of operating the service. Zone messages and whispers are subject to automated safety scanning.
      </Text>

      <Text style={styles.sectionTitle}>8. Limitation of Liability</Text>
      <Text style={styles.body}>
        To the maximum extent permitted by South African law, Khuloh shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the App. This includes, but is not limited to, damages arising from meetings arranged through the App, reliance on Trust Scores, or interactions with other users.
      </Text>

      <Text style={styles.sectionTitle}>9. Dispute Resolution</Text>
      <Text style={styles.body}>
        Any disputes arising from these Terms shall be governed by the laws of the Republic of South Africa. You agree to first attempt resolution through our in-app reporting system before pursuing legal remedies. Formal disputes shall be resolved through arbitration in accordance with the Arbitration Act, 1965 (Act 42 of 1965).
      </Text>

      <Text style={styles.sectionTitle}>10. Modifications</Text>
      <Text style={styles.body}>
        Khuloh may update these Terms at any time. We will notify users of material changes via in-app notification. Continued use of the App after changes constitutes acceptance of the updated Terms.
      </Text>

      <View style={styles.divider} />

      <Text style={styles.heading}>Privacy Policy</Text>
      <Text style={styles.subheading}>POPIA Compliance Notice</Text>
      <Text style={styles.updated}>
        This policy complies with the Protection of Personal Information Act, 2013 (Act 4 of 2013) ("POPIA") of the Republic of South Africa.
      </Text>

      <Text style={styles.sectionTitle}>1. Information Officer</Text>
      <Text style={styles.body}>
        Responsible Party: Khuloh (Pty) Ltd{"\n"}
        Information Officer: As designated under POPIA Section 55{"\n"}
        Contact: privacy@khuloh.co.za{"\n"}
        Regulator: Information Regulator (South Africa) — https://inforegulator.org.za
      </Text>

      <Text style={styles.sectionTitle}>2. Personal Information We Collect</Text>
      <Text style={styles.body}>
        In accordance with POPIA Section 9 (Lawfulness of Processing), we collect:{"\n"}{"\n"}
        <Text style={styles.bold}>Required for Service:</Text>{"\n"}
        • Mobile phone number (for authentication){"\n"}
        • Liveness verification data (biometric — processed and discarded){"\n"}
        • Username and bio (user-provided){"\n"}
        • GPS location (only during Safe-Spot check-ins, with consent){"\n"}{"\n"}
        <Text style={styles.bold}>Generated by Usage:</Text>{"\n"}
        • Trust Score (calculated from community reviews){"\n"}
        • Vibe Points balance and transaction history{"\n"}
        • Zone messages and whisper content (for safety scanning){"\n"}
        • Check-in history and meetup reviews{"\n"}{"\n"}
        <Text style={styles.bold}>We Do NOT Collect:</Text>{"\n"}
        • Real names or ID numbers{"\n"}
        • Financial information or banking details{"\n"}
        • Continuous location tracking{"\n"}
        • Contact lists or call logs
      </Text>

      <Text style={styles.sectionTitle}>3. Purpose of Processing (POPIA Section 13)</Text>
      <Text style={styles.body}>
        We process your personal information for the following specific purposes:{"\n"}
        • Providing the Khuloh dating and safety service{"\n"}
        • Verifying your identity through liveness detection{"\n"}
        • Operating the Vibe Economy (points, shouts, ghost mode){"\n"}
        • Facilitating Safe-Spot check-ins and partner verification{"\n"}
        • Running AI-powered scam and safety message scanning{"\n"}
        • Computing and maintaining Trust Scores{"\n"}
        • Enabling emergency contact safety alerts
      </Text>

      <Text style={styles.sectionTitle}>4. Lawful Basis for Processing</Text>
      <Text style={styles.body}>
        Under POPIA Section 11, we process your information based on:{"\n"}
        • Your explicit consent (provided at registration){"\n"}
        • Necessity for performing the service contract{"\n"}
        • Legitimate interest in maintaining platform safety{"\n"}
        • Compliance with law (where applicable)
      </Text>

      <Text style={styles.sectionTitle}>5. Special Personal Information (POPIA Section 26)</Text>
      <Text style={styles.body}>
        Khuloh's liveness verification uses biometric data (facial recognition). This data is:{"\n"}
        • Processed solely for identity verification{"\n"}
        • Not stored after verification is complete{"\n"}
        • Not shared with any third party{"\n"}
        • Protected by encryption during processing{"\n"}{"\n"}
        By completing liveness verification, you provide explicit consent for this processing as required by POPIA Section 27.
      </Text>

      <Text style={styles.sectionTitle}>6. Data Retention (POPIA Section 14)</Text>
      <Text style={styles.body}>
        • Account data: Retained while your account is active{"\n"}
        • Messages: Zone messages retained indefinitely; Whispers auto-expire per vibe mode settings{"\n"}
        • Biometric data: Discarded immediately after verification{"\n"}
        • Transaction history: Retained for the lifetime of the account{"\n"}
        • After account deletion: All personal data is permanently deleted within 30 days, except where retention is required by law
      </Text>

      <Text style={styles.sectionTitle}>7. Your Rights Under POPIA</Text>
      <Text style={styles.body}>
        As a data subject, you have the right to:{"\n"}
        • Access your personal information (Section 23){"\n"}
        • Correct or update inaccurate information (Section 24){"\n"}
        • Request deletion of your personal information (Section 24){"\n"}
        • Object to the processing of your information (Section 11(3)){"\n"}
        • Withdraw consent at any time (Section 11(2)(a)){"\n"}
        • Lodge a complaint with the Information Regulator{"\n"}{"\n"}
        To exercise these rights, contact privacy@khuloh.co.za or use the in-app Account Settings.
      </Text>

      <Text style={styles.sectionTitle}>8. Data Security (POPIA Section 19)</Text>
      <Text style={styles.body}>
        We implement appropriate technical and organisational measures to protect your personal information:{"\n"}
        • End-to-end encryption for whisper messages{"\n"}
        • Row-Level Security (RLS) on all database tables{"\n"}
        • Secure token-based authentication{"\n"}
        • Encrypted local storage for sensitive data{"\n"}
        • Regular security audits and vulnerability assessments{"\n"}
        • Data-Light mode to minimise data transmission
      </Text>

      <Text style={styles.sectionTitle}>9. Cross-Border Data Transfers (POPIA Section 72)</Text>
      <Text style={styles.body}>
        Your data may be processed on servers outside South Africa (cloud infrastructure). We ensure that any cross-border transfer complies with POPIA Section 72 requirements, including that the recipient country provides an adequate level of protection, or that binding agreements are in place to safeguard your information.
      </Text>

      <Text style={styles.sectionTitle}>10. Third-Party Services</Text>
      <Text style={styles.body}>
        Khuloh integrates with:{"\n"}
        • Supabase (authentication and data storage){"\n"}
        • Uber (optional ride booking to Safe-Spots){"\n"}{"\n"}
        Each third-party service has its own privacy policy. We do not sell, rent, or trade your personal information to any third party for marketing purposes.
      </Text>

      <Text style={styles.sectionTitle}>11. Children's Privacy</Text>
      <Text style={styles.body}>
        Khuloh is not intended for persons under 18 years of age. We do not knowingly collect personal information from children. If we become aware that a child has provided us with personal information, we will delete it immediately in accordance with POPIA Section 35.
      </Text>

      <Text style={styles.sectionTitle}>12. Contact Information</Text>
      <Text style={styles.body}>
        For privacy-related queries, POPIA access requests, or complaints:{"\n"}{"\n"}
        Email: privacy@khuloh.co.za{"\n"}
        Information Regulator: enquiries@inforegulator.org.za{"\n"}
        POPIA Complaints: PAIAComplaints@inforegulator.org.za
      </Text>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          🇿🇦 Proudly South African • POPIA Compliant
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: 20, paddingBottom: 64 },
  heading: { fontSize: 24, fontWeight: "800", color: T.text, marginBottom: 4 },
  subheading: { fontSize: 15, fontWeight: "700", color: T.primary, marginBottom: 4 },
  updated: { fontSize: 12, color: T.textMuted, marginBottom: 24 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: T.accent,
    marginTop: 20,
    marginBottom: 8,
  },
  body: { fontSize: 14, color: T.textSecondary, lineHeight: 22 },
  bold: { fontWeight: "700", color: T.text },
  divider: {
    height: 1,
    backgroundColor: T.border,
    marginVertical: 32,
  },
  footer: {
    marginTop: 40,
    alignItems: "center",
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: T.border,
  },
  footerText: { fontSize: 13, color: T.textMuted, fontWeight: "600" },
});
