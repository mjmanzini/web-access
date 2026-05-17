# Khuloh — Privacy Policy (Draft, POPIA-aligned)

> **DRAFT — NOT LEGAL ADVICE.** Review by a South African attorney
> familiar with the Protection of Personal Information Act 4 of 2013
> ("**POPIA**") is required before publication.
>
> Replace placeholders ({{LEGAL_ENTITY}}, {{COMPANY_REG}},
> {{REGISTERED_ADDRESS}}, {{INFO_OFFICER_NAME}},
> {{INFO_OFFICER_EMAIL}}, {{SUPPORT_EMAIL}}, {{EFFECTIVE_DATE}},
> {{LIVENESS_VENDOR}}, {{MAP_VENDOR}}, {{SMS_VENDOR}}) before
> publication.

**Effective date:** {{EFFECTIVE_DATE}}
**Responsible Party:** {{LEGAL_ENTITY}} (registration {{COMPANY_REG}}),
{{REGISTERED_ADDRESS}}.
**Information Officer:** {{INFO_OFFICER_NAME}},
{{INFO_OFFICER_EMAIL}} (registered with the Information Regulator
of South Africa).

This policy explains how Khuloh collects, uses, shares, retains, and
protects your personal information ("**personal information**" has the
meaning given in section 1 of POPIA).

## 1. The information we process

| Category               | Examples                                                        | Source                  |
| ---------------------- | --------------------------------------------------------------- | ----------------------- |
| Identification         | Mobile number, display name, date of birth (≥18 check)          | You, at sign-up         |
| Biometric              | Liveness video frames; derived face-template hash               | Camera, on-device       |
| Profile content        | Photos, voice notes, bio, intent mode (Chat/Connect/Ignite)     | You                     |
| Communications         | Messages and voice notes you send and receive in Zones and DMs   | You and your contacts   |
| Location               | Approximate city (always); precise GPS only on Safe-Spot check-in or Panic | Your device             |
| Device & technical     | Device model, OS version, app version, IP, network type, push token | Your device + servers |
| Behavioural            | Sessions, taps, Zone joins, ledger events, abuse reports         | Servers                 |
| Safety contacts        | Names, phone numbers, emails of people you nominate for Panic    | You                     |
| Payments (if applicable) | Last 4 digits of card, payment processor token                 | Payment processor       |

We do **not** request, and have no business need for, race,
political opinion, religion, health status, trade-union membership,
biometric information beyond the liveness check, or sexual
orientation. You may volunteer some of this in your bio; if you do,
you consent to its processing under section 27 of POPIA.

## 2. How and why we process it

| Purpose                                                       | Lawful basis (POPIA s.11)                |
| ------------------------------------------------------------- | ---------------------------------------- |
| Operating the messaging, Zones, profile, and matching service | Performance of contract                  |
| Liveness verification & Trust Badge                           | Consent + legitimate interest in safety  |
| Scam-Shield abuse detection and shadow-muting                 | Legitimate interest (preventing fraud, protecting users); legal obligation re: Cybercrimes Act |
| Safe-Spot check-ins                                           | Performance of contract + consent        |
| Panic Check-in alerts                                         | Consent + protection of vital interest   |
| Vibe Points ledger                                            | Performance of contract                  |
| Service analytics (aggregated, pseudonymous)                  | Legitimate interest                      |
| Marketing on our own channels                                 | Consent (section 69 POPIA / section 45 ECTA) — opt-out always available |
| Compliance with law, court orders, and lawful requests        | Legal obligation                         |

You can withdraw consent at any time where consent is the basis;
withdrawal does not affect prior lawful processing.

## 3. Automated decision-making (POPIA s.71)

3.1 The Scam-Shield system makes automated decisions that may delay,
block, or restrict your messages or account. This is permitted under
section 71(2)(a)(ii) of POPIA because it is necessary for the
conclusion or performance of a contract you have entered into with us.

3.2 You have the right to:
- be told that an automated decision has been taken,
- request human review by emailing {{SUPPORT_EMAIL}} within 30 days,
- make representations on the decision.

We will respond within 7 working days.

## 4. Liveness / biometric processing

4.1 During onboarding, your device captures a short video used to
confirm that the live face matches your profile photos. This is
performed by {{LIVENESS_VENDOR}} acting as our Operator.

4.2 The raw video is processed for liveness and discarded within
**24 hours**. Only a derived **face-template hash** (a non-reversible
mathematical representation) is retained, solely to detect duplicate
or fraudulent re-registration.

4.3 You may request deletion of the face-template hash by emailing
{{INFO_OFFICER_EMAIL}}; deletion will mean you can no longer use
verified-only features.

## 5. Sharing your information

We share personal information only with:

| Recipient                                | Why                                              | Safeguards                                         |
| ---------------------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| Cloud infrastructure (e.g. Firebase / Google Cloud) | Hosting, storage, real-time messaging  | Operator agreement; encryption in transit and at rest |
| {{LIVENESS_VENDOR}}                      | Liveness check                                    | Operator agreement; data-flow restricted to verification |
| {{MAP_VENDOR}}                           | Safe-Spot map tiles                               | Sees IP only, no profile data                      |
| {{SMS_VENDOR}}                           | OTP delivery, Panic alerts                        | Sees mobile number and message body only           |
| Payment processor (if used)              | Optional purchases                                | PCI-DSS compliant; we never store full card data   |
| Safe-Spot partners                       | Verified-user check-in fact only (no PII unless you consent) | Contract; QR-scoped data only            |
| Law enforcement / regulators             | When legally compelled, or to prevent imminent harm | Reviewed against POPIA and the Cybercrimes Act    |

Other Khuloh users see **only what you choose to display** on your
profile and what you send in chats and Zones.

## 6. Cross-border transfers (POPIA s.72)

Some Operators (e.g. cloud and SMS providers) may process your
personal information in countries outside South Africa. We rely on
section 72(1)(a) — those Operators are bound by laws or binding
corporate rules that uphold principles substantially similar to
POPIA, **or** we obtain your consent.

## 7. Retention

| Category                       | Retention period                                            |
| ------------------------------ | ----------------------------------------------------------- |
| Account & profile              | Until account deletion + 30 days reversal window            |
| Messages                       | Until you or the recipient deletes them, or 24 months idle  |
| Liveness raw video             | Maximum 24 hours                                            |
| Liveness face-template hash    | While account is active; 6 months after deletion (fraud)    |
| Vibe ledger                    | 7 years (financial-record analogy / dispute resolution)     |
| Safe-Spot meetups              | 24 months                                                   |
| Panic events and audit logs    | 5 years                                                     |
| Scam-Shield evidence           | 12 months, or longer when legally required                  |
| Payment records                | 5 years (Tax Administration Act)                            |
| Backups                        | Rolling 35 days, then automatic destruction                 |

After the retention period, personal information is deleted or
de-identified beyond reasonable re-identification.

## 8. Security

We protect personal information using:

- TLS 1.2+ in transit; AES-256 encryption at rest;
- separate encryption (KMS-managed key) for Panic-contact PII;
- principle-of-least-privilege access; multi-factor authentication for
  staff;
- rate limiting and Scam-Shield abuse controls (see
  [signaling-server/src/rate-limit.js](../../signaling-server/src/rate-limit.js));
- structured audit logging for sensitive operations;
- regular vulnerability scanning and incident response procedures.

If we become aware of a security compromise involving your personal
information, we will notify the Information Regulator and you as soon
as reasonably possible (POPIA s.22).

## 9. Your rights (POPIA Chapter 3, Part B)

You have the right to:
- access — request a copy of the personal information we hold about you;
- correction — ask us to correct or update inaccurate information;
- deletion — request deletion (subject to retention exceptions);
- objection — object to processing based on legitimate interest or
  for direct marketing;
- withdraw consent — for any processing based on consent;
- data portability — for information you have provided to us, in a
  structured, machine-readable format;
- complain — to the Information Regulator (see clause 12).

To exercise any right, email {{INFO_OFFICER_EMAIL}} (we may use Form
2 of the POPIA Regulations). We respond within 30 days at no charge,
unless the request is manifestly unfounded or excessive.

## 10. Children

Khuloh is for adults. We do not knowingly collect personal
information from anyone under 18. If we discover such information, we
delete it promptly and may report as required by law.

## 11. Cookies and local storage

The Khuloh PWA uses local storage and a service worker to cache the
app shell, queue offline messages, and remember your authentication
session. We do not use third-party advertising cookies.

## 12. Complaints

You may lodge a complaint with the **Information Regulator (South
Africa)**:

- 33 Hoofd Street, Forum III, Braampark Office Park,
  Braamfontein, Johannesburg, 2001
- complaints.IR@inforegulator.org.za
- https://inforegulator.org.za

## 13. Changes to this policy

We will notify you in-app of material changes at least 14 days before
they take effect. Continued use after the effective date constitutes
acceptance.

## 14. Contact

- Information Officer: {{INFO_OFFICER_NAME}}, {{INFO_OFFICER_EMAIL}}
- Support: {{SUPPORT_EMAIL}}
- Postal: {{REGISTERED_ADDRESS}}
