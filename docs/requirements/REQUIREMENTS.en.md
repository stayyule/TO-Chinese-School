# TOCS Chinese School Registration & Administration System Rewrite — Requirements (English)

- Status: **Draft for collaborative review**
- Chinese version: [REQUIREMENTS.zh-CN.md](REQUIREMENTS.zh-CN.md) (section and FR/BR/SEC numbering match one-to-one)
- Open questions: [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md)
- This document contains **no implementation** and **does not presuppose a technology choice**; options are compared only in Appendix A.
- Basis: read-only analysis of the existing system `chineseschool/` (Rails 3.2.13 + PostgreSQL). The "Source" lines cite existing code paths so reviewers can verify each item.
- Confidence note: Section 4 (business rules) was checked line by line against `student_fee_payment.rb`, `registration_payment.rb`, `school_year.rb` and `withdraw_request*.rb`. Section 3 (functional requirements) is inferred mainly from `config/routes.rb`, controller/view file names and the home-page role panels, and was **not verified page by page**; role representatives should review it closely.

---

## 1. Purpose and Scope

### 1.1 Purpose
Rewrite the existing Rails 3.2 system on another framework, **keeping the same business logic**, with a separated front end and back end, automated operations, deployed on a single Ubuntu cloud server.

### 1.2 In scope
Accounts and permissions, people and families, school-year configuration, grades and classes, class and instructor assignment, registration and payment, withdrawal and refund, accounting, final marks, communication forms, e-mail notifications, reports and exports.

### 1.3 Out of scope (explicitly not rewritten)
**The entire Track Event (athletics meet) feature is removed**, including:

| Category | Content |
|----------|---------|
| Routes | `activity/track_events/*` (sign-up, teams, heats, lane assignment, time entry and scoring, class scores, TOCS data CSV, etc.) |
| Models | `TrackEventProgram`, `TrackEventHeat`, `TrackEventSignup`, `TrackEventTeam`, `TrackEventAgeGroup`, `JerseyNumber` |
| Tables | `track_event_programs`, `track_event_heats`, `track_event_signups`, `track_event_teams`, `jersey_numbers` |
| Views / PDFs | `activity/track_events/*` (including `sign_up.pdf.prawn`, `tocs_lane_assignment_form.pdf.prawn`) |
| Legacy columns | Meet-number columns in `grades` (e.g. `jersey_number_prefix`) are ignored in the new system |
| Home page | Track-related entries in the `_activity_officer` role panel |

> Note: `activity/forms` (fire drill form, class information, students by class) is not part of the track feature; per Q-01 it is **kept** (see FR-COM-03).
>
> **The library feature is not rewritten either** (decided 2026-11-02, see 3.7): the `librarian/*` routes, the `LibraryBook` and `LibraryBookCheckout` models, the `library_books` and `library_book_checkouts` tables, the library search result PDF template, the Librarian panel on the home page, and the Librarian role.

### 1.4 Confirmed constraints
| ID | Constraint |
|----|------------|
| C-1 | Keep the existing PostgreSQL database and schema (about 29 tables after removing the 5 track tables and the 2 library tables); no data migration |
| C-2 | Separated front end and back end: REST API plus a single-page application |
| C-3 | Target environment is a **single Ubuntu cloud server** hosting both application and database |
| C-4 | Automated operations (containers, CI/CD, automatic migration, monitoring, backup) |

---

## 2. Roles and Permissions

The existing home page renders a panel per role (`app/views/home/_*.html.erb`). Roles:

| Role | Description |
|------|-------------|
| Student Parent | Maintains family and children, registers, pays, withdraws, views transactions |
| Instructor | Views own classes, enters final marks; role derived automatically from current-year assignments |
| Room Parent | Same mechanism, derived from the assignment role |
| Registration Officer | People/families, class assignment, instructor assignment, registration reports |
| Accounting Officer | In-person payments, manual transactions, payment reports, instructor discount |
| Instruction Officer / Academic Vice Principal | Teaching and class views and reports |
| Principal | Administration and oversight |
| PVA | Parent association (receives withdrawal notifications, etc.) |
| Communication Officer | Picture-taking form, yearbook student list |
| Activity Officer | Form-type features (track removed; forms kept per Q-01) |
| System administrator | School years, grades, classes, roles/rights, invitations |

- **FR-AUTH-05**: Authorization is a role → permission-code model, enforced server-side on every endpoint; a user may hold multiple roles.
  - Source: `app/models/user.rb#authorized?`, `right.rb`, `role.rb`
- **FR-AUTH-06**: Administrators can list rights, view role details, and add/remove users to/from roles.
  - Source: `admin/rights`, `admin/roles` (`add_user`, `remove_user`)
- **FR-AUTH-07**: Instructor and Room Parent roles are added/removed automatically from current-year instructor assignments (`adjust_instructor_roles`).
  - Source: `app/models/user.rb#adjust_instructor_roles`

---

## 3. Functional Requirements

Priority: **M** = Must, **S** = Should, **C** = Could. Acceptance criteria are written as given/when/then.

### 3.1 Accounts and Sign-in (AUTH)

| ID | Requirement | Pri | Acceptance |
|----|-------------|-----|------------|
| FR-AUTH-01 | Sign in with user name and password; return to the originally requested page afterwards | M | Unauthenticated access to a protected page → sign-in → success returns to that page |
| FR-AUTH-02 | Sign out, invalidating the session | M | After sign-out, protected endpoints return unauthenticated |
| FR-AUTH-03 | Administrator invites a person by e-mail to create an account (invitation link carries an expiring token) | M | Expired or used tokens are rejected |
| FR-AUTH-04 | Forgot password: e-mail a reset link with an expiring token; signed-in users can change their password | M | Token is single-use and time-limited |
| FR-AUTH-08 | Public pages: contact us, privacy statement, consent sample | S | Accessible without signing in |
| FR-AUTH-09 | Self-registration for new parents: enter address, parent one, username and password; creates address, person, family and account (Student Parent role) at once; rejected if the address email already exists | M | All-or-nothing; an already-registered email returns a conflict without revealing existing usernames; concurrent registrations of the same username yield exactly one success (added 2026-11-02, old `signin#register`) |
| FR-AUTH-10 | Forgot username: send the usernames to the email address | S | Same response whether or not the email exists; the page never shows usernames (added 2026-11-02, old `signin#forgot_username`; the old page displayed usernames, the new flow emails them) |

> Addendum to FR-AUTH-03/04: invitation sign-up and password reset must verify a phone number on submit (matching the home/cell number on the person's or their family's address, digits only) as an identity check; forgot-password responds identically for unknown usernames and users without an email address. Source: `signin_controller`, `person.rb#phone_number_correct?`.

Source: `signin_controller`, `signout_controller`, `timed_token.rb`, `signin_mailer`, `pages_controller`, `home/change_password`

### 3.2 Student Parent (STU)

| ID | Requirement | Pri | Acceptance |
|----|-------------|-----|------------|
| FR-STU-01 | Maintain own family, parents, children and address | M | A parent can read/write only their own family's data |
| FR-STU-02 | Choose registration preferences (grade/class preference, elective class, elective-only registration) | M | Preferences stored per school year |
| FR-STU-03 | View fee breakdown and pay online by credit card | M | Amounts match the BR rules; success creates a transaction record and receipt e-mail |
| FR-STU-04 | Request in-person payment (entered later by the Accounting Officer) | M | Creates a "pending in-person payment" visible to accounting |
| FR-STU-05 | Remove an unpaid pending registration payment | S | Own records only, unpaid only |
| FR-STU-06 | Payment confirmation page | M | Shows amount paid, students, transaction id |
| FR-STU-07 | Submit a withdrawal request (optionally elective-only); cancel a request not yet processed | M | Creates a pending request; visible/cancellable by its owner only |
| FR-STU-08 | View transaction history (own paid payments) | M | Newest first |
| FR-STU-09 | Home page shows current-year class assignments | S | Shows student, grade class, elective class |

Source: `student/registration_controller`, `student/withdraw_controller`, `student/transaction_history_controller`, `student/families_controller`, `student/people_controller`, `home/_student_parent`

### 3.3 Registration Officer (REG)

| ID | Requirement | Pri | Acceptance |
|----|-------------|-----|------------|
| FR-REG-01 | Search / view / create people and families | M | Search by name supported |
| FR-REG-02 | Select/adjust a student's grade, class and elective class | M | Saved to the current year's `student_class_assignments` |
| FR-REG-03 | Instructor assignment: choose class, start/end date, role; delete assignment | M | Saving adjusts instructor / room-parent roles |
| FR-REG-04 | Automatic/random grade-class assignment (controlled by the school-year flag `auto_class_assignment`) | S | No auto-assignment when the flag is off |
| FR-REG-05 | Class counts: students per grade class / elective class / grade | M | Counts only students assigned in the current year |
| FR-REG-06 | Reports: registration integrity check, siblings in the same grade | S | Output matches the old system on the same data |
| FR-REG-07 | Lists: active students by name, students by class (PDF) | M | Chinese names render correctly |

Source: `registration/*`

### 3.4 Accounting Officer (ACC)

| ID | Requirement | Pri | Acceptance |
|----|-------------|-----|------------|
| FR-ACC-01 | View pending in-person payments and record the payment | M | Recording marks it paid and triggers class assignment and receipt |
| FR-ACC-02 | Manual transactions: create, list, view | M | Records amount, reason, operator |
| FR-ACC-03 | Registration payment report by date; charges-collected summary | M | Date boundaries use Pacific time |
| FR-ACC-04 | View/set instructor discount | S | Consistent with BR-FEE-08 |

Source: `accounting/*`

### 3.5 Administrator (ADM)

| ID | Requirement | Pri | Acceptance |
|----|-------------|-----|------------|
| FR-ADM-01 | School-year management: create/edit/view with fee and date configuration; toggle auto class assignment; edit book charges | M | All `school_years` fields in the BR sections; `previous_school_year` linked automatically |
| FR-ADM-02 | Grade management | M | — |
| FR-ADM-03 | Class management: create, edit, activate/deactivate (per year) | M | Inactive classes do not appear as assignment options |
| FR-ADM-04 | Staff assignments | M | Determines staff-discount eligibility |
| FR-ADM-05 | Withdrawal-request handling: list, approve/decline | M | Approval applies side effects per BR-REF |
| FR-ADM-06 | Invite registration (see FR-AUTH-03) | M | — |

Source: `admin/*`

### 3.6 Instruction (INS)

| ID | Requirement | Pri | Acceptance |
|----|-------------|-----|------------|
| FR-INS-01 | Instructors view their own current-year classes and rosters | M | Own assigned classes only |
| FR-INS-02 | Enter/view final marks; download marks; view previous years' marks | M | Entry opens May 1 of the year in which `end_date` falls |
| FR-INS-03 | Instruction roles view all active classes | S | — |

Source: `instruction/*`, `school_year.rb#start_date_for_entering_student_final_mark`

### 3.7 Library (LIB) — removed (out of scope)

Decided 2026-11-02: the library feature is not rewritten. FR-LIB-01 (book list / add / read-only view), FR-LIB-02 (checkout / return records) and FR-LIB-03 (search by student and export PDF) are all cancelled. The 3.7 number is kept so that later section numbers and the review checklist do not shift.

Source (for reference only): `librarian/*`, `library_books`, `library_book_checkouts`

### 3.8 Communication and Forms (COM)

| ID | Requirement | Pri | Acceptance |
|----|-------------|-----|------------|
| FR-COM-01 | Picture-taking consent form (PDF) | S | — |
| FR-COM-02 | Yearbook student list | S | — |
| FR-COM-03 | Fire drill form, class information, students by class (`activity/forms`) | S | Q-01 decided: keep; exports of lists containing student personal data are audit-logged |

Source: `communication/forms_controller`, `activity/forms_controller`

### 3.9 E-mail Notifications (MAIL)

| ID | E-mail | Trigger |
|----|--------|---------|
| FR-MAIL-01 | Account invitation / forgot password | Invitation, password recovery |
| FR-MAIL-02 | Payment confirmation (receipt) | Successful payment |
| FR-MAIL-03 | Text-book notification, registration-staff notification | After successful payment when school starts within 1 day; staff notification only after the start date |
| FR-MAIL-04 | Credit-card transaction error alert (ops) | Gateway error |
| FR-MAIL-05 | Withdrawal notices: instructors, parent, registration, accounting, PVA | On approval; instructor notice only when school starts within 1 day |

Source: `app/mailers/*`, `app/views/*_mailer/*`

---

## 4. Business Rules (testable)

> All amounts are **integer cents** (`*_in_cents`). "Today" always means the **Pacific-time** date (`PacificDate.today`).

### 4.1 Tuition and fees (BR-FEE) — source `student_fee_payment.rb`

Per-student fee = registration fee + tuition + book charge + elective class fee.

- **BR-FEE-01 Registration fee**: the school year's `registration_fee_in_cents`.
- **BR-FEE-02 Elective class fee**: 0 if no elective class; otherwise the year's `elective_class_fee_in_cents`.
- **BR-FEE-03 Book charge**: determined by `BookCharge` for the school year and grade.
- **BR-FEE-04 Base tuition**: if today ≤ `early_registration_end_date` and `early_registration_tuition_in_cents > 0`, use the early-registration tuition and flag `early_registration`; otherwise `tuition_in_cents`.
- **BR-FEE-05 Parent-and-student class fee**: for the "Everyday Chinese parent-and-student" class type, add the fee to tuition (early fee if today ≤ early-registration end date, otherwise the standard fee).
- **BR-FEE-06 Pre-K discount**: for the preschool grade with `tuition_discount_for_pre_k_in_cents > 0`, subtract it and flag `pre_k_discount`.
- **BR-FEE-07 Multiple-child discount**: if at least 2 students precede this one among paid and pending fee payments (i.e. the 3rd and later) and the discount > 0, subtract `tuition_discount_for_three_or_more_child_in_cents`.
- **BR-FEE-08 Staff and instructor discount** (applied after the late-registration proration):
  - If the student's family has staff this year: only when no staff discount already exists among paid and pending fee payments, set tuition to 0 and flag `staff_discount` (a staff discount is granted only once);
  - If there is no staff but there is an instructor: the instructor discount applies to at most **2** students; subtract `tuition_discount_for_instructor_in_cents` (only if > 0);
  - If a family has both staff and instructor, only the staff discount applies.
- **BR-FEE-09 Late-registration proration**: if today > `registration_75_percent_date`, tuition = `trunc(tuition × 0.75)` and flag `prorate_75`. (The 50% date has been unused since the 2017-18 year.)
- **BR-FEE-10 Order of application**: base tuition → parent-and-student class fee → Pre-K discount → multiple-child discount → late proration → staff/instructor discount.
- **BR-FEE-11 Rounding**: all proration uses **truncation** (`.to_i`); the new system must reproduce it.

> Decision (Q-10 decided, 2026-11-02): **reproduce the order above faithfully.** It only affects late-registering instructor families: the instructor discount is subtracted after proration, so it is not reduced by 75%. Example (hypothetical numbers): tuition 600, instructor discount 100 → today 600×0.75−100 = 350; if the discount came first, (600−100)×0.75 = 375. Golden cases must cover "late registration + instructor discount" and mark it as known, intentionally kept behavior.
>
> Edge: instructor and Pre-K discounts are subtracted with no floor, so tuition goes negative when the discount exceeds it. Reproduce by default and pin the behavior with a golden case; change it separately if the business owners object to negative tuition. The Accounting Officer's confirmation that the instructor discount should not be prorated is still open.

### 4.2 Membership dues and totals (BR-PAY) — source `registration_payment.rb`

- **BR-PAY-01 PVA dues**: 0 if the family already has a completed registration this year; otherwise `pva_membership_due_in_cents` (once per family; since 2024/04 the same rule as CCCA).
- **BR-PAY-02 CCCA dues**: 0 if a completed registration exists; 0 if any family of the payer is a CCCA lifetime member; otherwise `ccca_membership_due_in_cents`.
- **BR-PAY-03 Grand total**: `grand_total = pva + ccca + Σ(per-student total)`.
- **BR-PAY-04 After payment**: create student class assignments; send receipt; send text-book and registration-staff notices when conditions hold (see FR-MAIL-03).
- **BR-PAY-05 Queries**: paid / pending / pending in-person; "payments for a date" converts the Pacific day boundary to UTC.

### 4.3 Withdrawal and refund (BR-REF) — source `school_year.rb`, `withdraw_request*.rb`

- **BR-REF-01 Tuition refund ratio** (Q-11 decided; first match wins):
  1. School not yet started → 100%;
  2. today > `refund_end_date` → **0 (no refund)**;
  3. today > `refund_50_percent_date` → 50%;
  4. today > `refund_90_percent_date` → 90%;
  5. otherwise 100%.
  (The legacy `refund_25_percent_date` and `refund_75_percent_date` are no longer used and their branches are not implemented. Step 2 is a fix to intent: the old branch is never taken, see the decision below. Proportional refunds use integer arithmetic; the rounding mode is set after the golden cases are measured.)
- **BR-REF-02 PVA/CCCA refund** (Q-11 decided, corrected): both dues are charged per family. They are refunded in full, from the family's earliest paid payment, only when school has not started and the family has no registered students left after the withdrawal; no refund if 1 or more students remain, or once school has started. (Since 2024-04-14; the old proportional PVA refund function is dead code and is not implemented.)
- **BR-REF-02a Non-refundable items**: the registration fee is never refunded; the book charge is refunded only before school starts; the elective class fee (whole-class or elective-only withdrawal) is refunded in full regardless of date.
- **BR-REF-03 Refund total**: `refund_pva + refund_ccca + Σ(detail: registration fee + book charge + tuition + elective fee)`.
- **BR-REF-04 Side effects (single transaction)**: create a `WithdrawalRecord` per student (registration date, withdrawal date, original grade/class/elective); unless "elective only", set the student status to not registered and delete the class assignment; if "elective only", keep the class assignment, set only the elective class to 0, and clear the elective class in the registration preference; notify instructors if school starts within 1 day.
- **BR-REF-05 Status**: Pending P, Approved A, Declined D, Cancelled C.

> Decision (Q-11 decided, 2026-11-02):
> 1. The old `refund_end_date` check is written as `!self.refund_end_date && today > refund_end_date`; when the date is present it is always false, so a proportional refund is still computed after the end date, and when the date is nil it raises. But the parent-side UI shows the withdraw entry only while `refund_end_date >= today`, and the refund is computed at submission, so nothing can be submitted after the end date in normal use. The new system **fixes this to intent (0)** and checks the date on the server at both submission and approval, without relying on the UI hiding the entry.
> 2. Only the 50%/90% tiers are active; the legacy 25%/75% columns are not implemented.
> 3. Golden cases record both the old system's actual output and the new corrected output: they must match on non-end-date cases, and the new system returns 0 after the end date.

### 4.4 Other rules (BR-MISC)

- **BR-MISC-01 School year**: `current_school_year` = earliest year whose end date ≥ today; `next_school_year` is the one after; registration-open years = early-registration start ≤ today ≤ registration end; refund-open years = refund end ≥ today.
- **BR-MISC-02 School-year validation**: start date must not be after end date; most fee fields must be positive integers (discount fields may be 0).
- **BR-MISC-03 Age cutoff month**: `age_cutoff_month` in the school-year configuration is used to determine a student's grade/age eligibility.
- **BR-MISC-04 Final-mark entry window**: opens May 1 of the end year.

---

## 5. Data Requirements

- Keep the existing PostgreSQL schema (C-1). Core tables retained:
  `addresses`, `book_charges`, `families`, `families_children`, `gateway_transactions`, `grades`, `in_person_registration_transactions`, `instructor_assignments`, `manual_transactions`, `people`, `registration_payments`, `registration_preferences`, `rights`, `rights_roles`, `roles`, `roles_users`, `school_class_active_flags`, `school_classes`, `school_years`, `staff_assignments`, `student_class_assignments`, `student_fee_payments`, `student_final_marks`, `student_status_flags`, `timed_tokens`, `users`, `withdraw_request_details`, `withdraw_requests`, `withdrawal_records`.
- Removed (out of scope): `track_event_heats`, `track_event_programs`, `track_event_signups`, `track_event_teams`, `jersey_numbers`. (Q-12 decided, 2026-11-02) The new system does **not migrate** these tables; they are not part of its data model and must never be read or written. They are **kept untouched** in the production DB (never read or written, and this data is not migrated).
- Removed (out of scope, 2026-11-02): `library_books`, `library_book_checkouts` (the library feature is not rewritten). Handled like the track tables: not part of the new data model and never read or written; kept untouched in the production DB, and this data is not migrated.
- **DATA-01 Join tables without id**: `families_children(family_id, child_id)`, `rights_roles`, `roles_users`.
- **DATA-02 Non-conventional foreign keys**: `families.parent_one_id/parent_two_id`; `registration_payments.paid_by_id`, `withdraw_requests.request_by_id/status_by_id`, etc. point to `people`.
- **DATA-03 Money**: all `*_in_cents` integers; the new system must not store or compute money in floating point.
- **DATA-04 Password columns**: `password_hash` (`SHA256(password+salt)` hex) and `password_salt`. (Q-08 decided) Add `password_hash_v2` to hold the argon2id string; keep the two old columns until after the upgrade deadline, then clear and drop them.
- **DATA-05 `db/schema.rb` is authoritative**; the migration files are incomplete (earliest 2014). A sanitized copy of the production schema must be obtained and compared before review closes.

---

## 6. External Integrations

| ID | Integration | Current state | Requirement |
|----|-------------|---------------|-------------|
| INT-01 | Payment gateway | ActiveMerchant → Authorize.net (the `AUTHORIZE_NET_GATEWAY` constant is not in the repo; credentials live on the server); card numbers are not stored, only type and last digits | Keep the feature (Q-02 decided): continue with Authorize.net; switch to embedded tokenization so the browser sends the card number straight to the gateway for a token and the back end charges with the token only; payments behind an interface; move credentials to environment variables; see SEC-05 |
| INT-02 | E-mail | SMTP; 4 mailers, 10 templates | Keep (Q-07 decided): transactional mail service (prefer Postmark, or Amazon SES) via standard SMTP; sending domain `to-cs.org`, keeping the existing From addresses; SPF/DKIM/DMARC see SEC-15 |
| INT-03 | PDF | 7 Prawn templates, 2 of which are track (removed) and 1 is the library search result (removed); kept: class lists ×2, picture-taking form, fire drill form (Q-01 decided: keep, 4 in total) | Keep, including Chinese font |
| INT-04 | CSV | Generated inline in controllers (marks download, class information, student lists, etc.) | Keep |
| INT-05 | `data-export/` scripts | Standalone Sequel + MySQL scripts; school-year id and credentials edited by hand | (Q-09 decided) All 13 scripts move into a back-end report-export module that outputs CSV; school year is a page parameter; each report has an explicit permission code; every export is audit-logged; the track script is dropped with the feature. Core features first, reports one phase later |

---

## 7. Non-functional Requirements

- **NFR-01 Chinese**: PDFs and pages fully support Chinese (the existing system embeds Arial Unicode).
- **NFR-02 Time zone**: all business date rules use Pacific time; tests must be able to freeze time.
- **NFR-03 Scale** (Q-03 decided, 2026-11-02): 300–1000 families per school year (~450–1500 students); registration clusters around the early-bird deadline. Single host 2 vCPU / 4GB / 40GB+, designed for 150 concurrent users and ~20 payments/min with ~3x headroom. Payment submission must be idempotent; fee calculation, payment record and class assignment must run in one database transaction. Acceptance: load test with 150 concurrent parents through the full flow (sandbox payments) before the early-bird deadline. Assumptions to be calibrated with real production data.
- **NFR-04 Availability** (Q-04 decided, 2026-11-02): a single server is a single point of failure. Normal RPO ≤ 24h; registration-period RPO ≤ 1h; RTO ≤ 4h. Whether a hot standby is needed around the early-bird deadline is for the business owners to confirm.
- **NFR-05 Audit**: failed sign-ins, role/permission changes, refund approvals, manual transactions and exports of personal data must be audit-logged.
- **NFR-06 Testability**: the BR rules need automated unit tests covering date boundaries and rounding.
- **NFR-07 Maintainability**: every new endpoint must declare a permission code explicitly; default deny.

---

## 8. Deployment and Operations (single Ubuntu cloud server)

- **OPS-01 Topology**: on one host, a reverse proxy (terminating TLS) → back-end service + front-end static files + PostgreSQL, orchestrated with Docker Compose or systemd. PostgreSQL listens on localhost / the container network only.
- **OPS-02 CI/CD**: a commit triggers lint → tests (against a real PostgreSQL) → image build → deploy; production deploy requires manual approval.
- **OPS-03 Migration**: a backup is taken automatically before each deploy, then database migrations run automatically; failure rolls back to the previous image.
- **OPS-04 Configuration and secrets**: environment variables or restricted-permission files (600); never committed.
- **OPS-05 Monitoring**: `/healthz`, structured logs, CPU/memory/disk/certificate-expiry alerts, error reporting; alerts for payment and mail failures.
- **OPS-06 Backup** (Q-04 decided): daily encrypted `pg_dump` normally; during registration prefer WAL archiving (else hourly backups). Backups are encrypted before upload, the key is not kept on the server, and copies go to object storage under a different cloud vendor account. Retention: daily 30 days, monthly 12 months. At least one restore drill per year before registration opens.
- **OPS-07 Single-host limits**: no high availability; the host must be rebuildable quickly from scripts (infrastructure as code).

---

## 9. Security Requirements and Recommendations

### 9.1 Issues found in the existing code (must be eliminated)

| ID | Current issue | Recommendation |
|----|---------------|----------------|
| SEC-01 | The legacy catch-all route `match ':controller(/:action(/:id))'` at the end of `routes.rb` makes every controller action reachable by GET, widening the attack surface and bypassing CSRF | Expose only explicitly declared endpoints, default deny; state-changing operations only via POST/PUT/DELETE |
| SEC-02 | Passwords are `SHA256(password + 6-byte salt)`, weak against brute force; minimum length 6 | Use argon2id (or bcrypt); raise the minimum length; rate-limit and lock; upgrade old hashes after the first successful sign-in (Q-08) |
| SEC-03 | Authorization matches Rails `controller/action` strings | Use explicit permission codes; perform **object-level** authorization on every endpoint (a parent may access only their own family/children — prevent IDOR) |
| SEC-04 | `sibling_in_same_grade` uses string-concatenated SQL | Parameterized queries everywhere; no concatenation |
| SEC-05 | Payment: location of `AUTHORIZE_NET_GATEWAY` credentials is unclear | Never store or log card numbers; **card numbers must not pass through our server** (Q-02 decided: embedded tokenization, the browser gets the token from the gateway directly); keep credentials in server environment variables and rotate them; development and testing use sandbox accounts only; confirm the matching PCI self-assessment level against the official docs during design |
| SEC-06 | Rails cookie session; `TimedToken` tokens are stored in clear | Cookies HttpOnly, Secure, SameSite; CSRF protection; reset/invitation tokens single-use, short-lived and **stored only as hashes** |
| SEC-07 | `lib/key/` (gitignored) and hard-coded user name in `database.yml` | No secrets in the repository; enable secret scanning in CI |
| SEC-08 | Large amount of personal data on minors and parents (names, phones, addresses) | Minimize fields, mask by role, audit-log exports (CSV/PDF), define retention and deletion procedures |

### 9.2 Ubuntu host hardening

- **SEC-10 Network**: open only 80/443 and SSH (UFW plus cloud security group); SSH key-only, no root or password login, restrict source IPs, enable Fail2ban.
- **SEC-11 System**: enable unattended-upgrades for security updates; minimal install; disable unused services.
- **SEC-12 Containers**: run as non-root, read-only root filesystem, drop unneeded capabilities; never expose the Docker daemon port.
- **SEC-13 Database**: localhost only; the application uses a least-privilege dedicated role (not superuser); `scram-sha-256`; encrypted backups; disk (cloud volume) encryption.
- **SEC-14 TLS**: Let's Encrypt with auto-renewal; HSTS; disable legacy protocols; security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy).
- **SEC-15 Mail** (Q-07 decided): configure SPF, DKIM, DMARC for `to-cs.org`. Merge the new sender into the existing SPF record, never add a second one; DMARC starts at `p=none` for 1–2 weeks, then moves to `quarantine`. Alert on bounce rate, complaint rate and send failures.
- **SEC-16 Supply chain**: dependency and image vulnerability scanning in CI, pinned versions, timely upgrades.
- **SEC-17 Logging and audit**: centralized logs with restricted access and redaction (no card numbers, passwords or tokens); defined retention.
- **SEC-18 Single-host risk**: application and database on one host means a compromised application can reach the database — least-privilege DB accounts, container-network isolation and off-host encrypted backups are the key compensating controls.

---

## 10. Migration and Verification Strategy

- **MIG-01 Password compatibility** (Q-08 decided, 2026-11-02): the new system must verify the old `SHA256(password+salt)` and silently upgrade to argon2id on a successful sign-in with the old password (only the hash changes, not the password). The deadline is 6 months after launch (away from the registration peak); accounts still on the old hash then lose it and reset by email. The new password rule (minimum 10 characters) applies only on change/reset. Sign-in rate limiting and lockout must ship before launch; failed sign-ins, resets and hash upgrades go to the audit log.
- **MIG-02 Permission mapping**: build an old (controller, action) → new permission-code mapping and assert per entry that role access matches the old system.
- **MIG-03 Money golden cases**: generate from the old system a table of tuition/dues/refund amounts for fixed inputs (date boundaries, multiple children, staff/instructor, late proration, parent-and-student class); the new system must pass them.
- **MIG-04 Parallel verification** (Q-05 decided, 2026-11-02): the new system connects only to a **sanitized copy** of the production DB and its people/class/transaction summary reports are compared with the old system's output; the two systems never share the production DB.
- **MIG-06 Cutover** (Q-05 decided): after sign-off, in a low-traffic window (between registration periods, away from the early-bird deadline), stop the old system, take a final backup, and let the new system take over the DB in one step; only one system writes to the DB at any time.
- **MIG-05 Track data** (Q-12 decided): not migrated; the new data model excludes these 5 tables and ignores the `grades.jersey_number_prefix` column. These 5 tables and the 2 library tables (7 in total) are kept untouched and not migrated in the production DB: the application account gets no privileges on them, the Prisma baseline excludes them, and the migration tool must never auto-`DROP`.

---

## Appendix A: Technology Comparison (no decision; for review)

| Aspect | Django + DRF | NestJS (TypeScript) |
|--------|--------------|---------------------|
| Generate models from existing DB | `inspectdb` | Prisma `db pull` |
| Migrations | Django migrations (start with `managed=False` on the legacy DB) | Prisma Migrate (needs a baseline) |
| Admin UI | Built-in admin can replace some admin pages | None; must be built |
| Permissions | DRF permission classes | Guards/decorators |
| Background jobs | Celery + Redis (or lighter django-q) | BullMQ + Redis |
| PDF (Chinese) | ReportLab / WeasyPrint | pdfmake / Puppeteer |
| Testing | pytest-django, freezegun | Jest, fake timers |
| Language sharing | Different language from the front end | Shares TypeScript with the front end; shared types/OpenAPI |
| Single-host resources | Moderate memory; Celery/Redis are extra processes | Moderate memory; Redis also extra |

| Aspect | React | Vue 3 |
|--------|-------|-------|
| Build | Vite + TypeScript | Vite + TypeScript |
| Routing/state/requests | React Router, TanStack Query, Zustand | Vue Router, TanStack Query (Vue), Pinia |
| UI library | MUI or Ant Design | Element Plus or Ant Design Vue |
| Ecosystem / hiring | Largest | Large, quick to learn |
| Similarity to ERB | Low (JSX) | Higher (template syntax) |

> On a single host the back-end options differ little; the choice mainly depends on team skills and whether a built-in admin UI is wanted. **This table is for review only and is not a decision.**
>
> **Update (2026-11-02, Q-06 decided):** back end NestJS + Prisma, front end React (Vite + TypeScript). The table is kept as the decision rationale.

## Appendix B: Glossary (Chinese / English)

| 中文 | English | Note |
|------|---------|------|
| 学年 | School Year | Central configuration object, with fees and dates |
| 家庭 | Family | Up to two parents plus children |
| 人员 | Person | Students, parents, instructors, etc. |
| 年级 / 班级 | Grade / School Class | Grade classes and electives |
| 选修班 | Elective Class | Extra fee |
| 分班 | Class Assignment | Yearly student–class relation |
| 教师任课分配 | Instructor Assignment | Has a role and date range |
| 班级家长 | Room Parent | Derived from the assignment role |
| 员工分配 | Staff Assignment | Determines the staff discount |
| 注册付款 | Registration Payment | One family payment covering several students |
| 学生费用明细 | Student Fee Payment | Per-student registration/tuition/book/elective fees |
| PVA | PVA | One of the dues; abbreviation only, no full name needed (Q-13 decided) |
| CCCA | CCCA | One of the dues, waived for lifetime members; abbreviation only, no full name needed (Q-13 decided) |
| 早鸟 | Early Registration | Early tuition and deadline |
| 迟报折算 | Late Registration Prorate | 75% proration |
| 多孩折扣 | Multiple-Child Discount | 3rd and later students |
| 退课 | Withdraw | Withdrawal request and refund |
| 期末成绩 | Student Final Mark | Instructors enter from May |
| 太平洋时间 | Pacific Time | Basis for all business dates |
