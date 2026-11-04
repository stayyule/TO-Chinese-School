-- TOCS baseline schema (PostgreSQL), derived from chineseschool/db/schema.rb.
-- 29 retained tables; the 7 unmigrated track-event/library tables are intentionally omitted.
-- schema.rb is NOT authoritative (DATA-05): verify with scripts/check-schema-drift.mjs against a production dump.
-- Id-less join tables (families_children, rights_roles, roles_users) deliberately have NO constraints
-- (production may contain duplicates; see check-schema-drift.mjs --duplicates).

CREATE TABLE addresses (
  id serial PRIMARY KEY,
  street varchar(255),
  city varchar(255),
  state varchar(255),
  zipcode varchar(255),
  home_phone varchar(255),
  cell_phone varchar(255),
  email varchar(255),
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE book_charges (
  id serial PRIMARY KEY,
  grade_id integer NOT NULL,
  school_year_id integer NOT NULL,
  book_charge_in_cents integer NOT NULL DEFAULT 2000,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE families (
  id serial PRIMARY KEY,
  parent_one_id integer,
  parent_two_id integer,
  address_id integer,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone,
  ccca_lifetime_member boolean NOT NULL DEFAULT false
);

CREATE TABLE families_children (
  family_id integer,
  child_id integer,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE gateway_transactions (
  id serial PRIMARY KEY,
  registration_payment_id integer,
  amount_in_cents integer,
  credit_card_type varchar(255),
  credit_card_last_digits varchar(255),
  approval_status varchar(255),
  error_message varchar(255),
  approval_code varchar(255),
  reference_number varchar(255),
  credit boolean NOT NULL DEFAULT false,
  response_dump text,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE grades (
  id serial PRIMARY KEY,
  chinese_name varchar(255),
  english_name varchar(255),
  short_name varchar(255),
  next_grade integer,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone,
  jersey_number_prefix varchar(255)
);

CREATE TABLE in_person_registration_transactions (
  id serial PRIMARY KEY,
  registration_payment_id integer,
  recorded_by_id integer,
  payment_method varchar(255),
  check_number varchar(255),
  note text,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE instructor_assignments (
  id serial PRIMARY KEY,
  school_year_id integer,
  school_class_id integer,
  instructor_id integer,
  start_date date,
  end_date date,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone,
  role varchar(255)
);

CREATE TABLE manual_transactions (
  id serial PRIMARY KEY,
  recorded_by_id integer,
  student_id integer,
  transaction_by_id integer,
  amount_in_cents integer NOT NULL DEFAULT 0,
  transaction_type varchar(255),
  transaction_date date,
  payment_method varchar(255),
  check_number varchar(255),
  note text,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE people (
  id serial PRIMARY KEY,
  english_last_name varchar(255),
  english_first_name varchar(255),
  chinese_name varchar(255),
  gender varchar(255),
  birth_year integer,
  birth_month integer,
  native_language varchar(255),
  address_id integer,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE registration_payments (
  id serial PRIMARY KEY,
  school_year_id integer,
  paid_by_id integer,
  pva_due_in_cents integer,
  ccca_due_in_cents integer,
  grand_total_in_cents integer,
  paid boolean NOT NULL DEFAULT false,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone,
  request_in_person boolean NOT NULL DEFAULT false,
  elective_class_due_in_cents integer NOT NULL DEFAULT 0
);

CREATE TABLE registration_preferences (
  id serial PRIMARY KEY,
  school_year_id integer,
  student_id integer,
  entered_by_id integer,
  previous_grade_id integer,
  grade_id integer,
  school_class_type varchar(255),
  elective_class_id integer,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone,
  re_register_elective_class_id integer DEFAULT 0
);

CREATE TABLE rights (
  id serial PRIMARY KEY,
  name varchar(255),
  controller varchar(255),
  action varchar(255),
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE rights_roles (
  right_id integer,
  role_id integer,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE roles (
  id serial PRIMARY KEY,
  name varchar(255),
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE roles_users (
  role_id integer,
  user_id integer,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE school_class_active_flags (
  id serial PRIMARY KEY,
  school_class_id integer,
  school_year_id integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE school_classes (
  id serial PRIMARY KEY,
  english_name varchar(255),
  chinese_name varchar(255),
  description varchar(255),
  location varchar(255),
  max_size integer,
  min_age integer,
  max_age integer,
  grade_id integer,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone,
  short_name varchar(255),
  school_class_type varchar(255)
);

CREATE TABLE school_years (
  id serial PRIMARY KEY,
  name varchar(255),
  description varchar(255),
  start_date date,
  end_date date,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone,
  registration_start_date date,
  registration_75_percent_date date,
  registration_50_percent_date date,
  registration_end_date date,
  refund_75_percent_date date,
  refund_50_percent_date date,
  refund_25_percent_date date,
  refund_end_date date,
  age_cutoff_month integer,
  registration_fee_in_cents integer NOT NULL DEFAULT 2000,
  tuition_in_cents integer NOT NULL DEFAULT 38000,
  pva_membership_due_in_cents integer NOT NULL DEFAULT 1500,
  ccca_membership_due_in_cents integer NOT NULL DEFAULT 2000,
  early_registration_end_date date,
  early_registration_tuition_in_cents integer NOT NULL DEFAULT 38000,
  tuition_discount_for_three_or_more_child_in_cents integer NOT NULL DEFAULT 3800,
  tuition_discount_for_pre_k_in_cents integer NOT NULL DEFAULT 4000,
  previous_school_year_id integer,
  early_registration_start_date date,
  tuition_discount_for_instructor_in_cents integer NOT NULL DEFAULT 0,
  refund_90_percent_date date,
  auto_class_assignment boolean NOT NULL DEFAULT false,
  parent_and_student_class_fee_in_cents integer NOT NULL DEFAULT 0,
  elective_class_fee_in_cents integer NOT NULL DEFAULT 5000,
  early_registration_parent_and_student_class_fee_in_cents integer NOT NULL DEFAULT 0 -- verify against production (used by Rails model, absent from schema.rb)
);

CREATE TABLE staff_assignments (
  id serial PRIMARY KEY,
  school_year_id integer NOT NULL,
  person_id integer NOT NULL,
  role varchar(255),
  start_date date,
  end_date date,
  created_at timestamp(6) without time zone NOT NULL,
  updated_at timestamp(6) without time zone NOT NULL
);

CREATE TABLE student_class_assignments (
  id serial PRIMARY KEY,
  student_id integer,
  grade_id integer,
  school_class_id integer,
  elective_class_id integer,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone,
  school_year_id integer
);

CREATE TABLE student_fee_payments (
  id serial PRIMARY KEY,
  registration_payment_id integer,
  student_id integer,
  registration_fee_in_cents integer,
  tuition_in_cents integer,
  book_charge_in_cents integer,
  early_registration boolean NOT NULL DEFAULT false,
  multiple_child_discount boolean NOT NULL DEFAULT false,
  pre_k_discount boolean NOT NULL DEFAULT false,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone,
  prorate_75 boolean NOT NULL DEFAULT false,
  prorate_50 boolean NOT NULL DEFAULT false,
  instructor_discount boolean NOT NULL DEFAULT false,
  staff_discount boolean NOT NULL DEFAULT false,
  elective_class_fee_in_cents integer NOT NULL DEFAULT 0 -- verify against production (migration exists, absent from schema.rb)
);

CREATE TABLE student_final_marks (
  id serial PRIMARY KEY,
  school_year_id integer NOT NULL,
  school_class_id integer NOT NULL,
  student_id integer NOT NULL,
  top_three integer,
  progress_award boolean NOT NULL DEFAULT false,
  spirit_award boolean NOT NULL DEFAULT false,
  attendance_award boolean NOT NULL DEFAULT false,
  total_score double precision,
  created_at timestamp(6) without time zone NOT NULL,
  updated_at timestamp(6) without time zone NOT NULL,
  talent_award boolean
);

CREATE TABLE student_status_flags (
  id serial PRIMARY KEY,
  student_id integer,
  school_year_id integer,
  last_status_change_date date,
  registered boolean NOT NULL DEFAULT false,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE timed_tokens (
  id serial PRIMARY KEY,
  token varchar(255),
  person_id integer,
  expiration timestamp(6) without time zone,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE users (
  id serial PRIMARY KEY,
  username varchar(255),
  password_hash varchar(255),
  password_salt varchar(255),
  person_id integer,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE TABLE withdraw_request_details (
  id serial PRIMARY KEY,
  withdraw_request_id integer,
  student_id integer,
  refund_registration_fee_in_cents integer,
  refund_tuition_in_cents integer,
  refund_book_charge_in_cents integer,
  created_at timestamp(6) without time zone NOT NULL,
  updated_at timestamp(6) without time zone NOT NULL,
  refund_elective_class_fee_in_cents integer NOT NULL DEFAULT 0,
  elective_class_fee_in_cents integer NOT NULL DEFAULT 0,
  elective_class_only varchar(255) DEFAULT 'N'
);

CREATE TABLE withdraw_requests (
  id serial PRIMARY KEY,
  request_by_id integer,
  request_by_name varchar(255),
  request_by_address varchar(255),
  school_year_id integer,
  refund_pva_due_in_cents integer,
  refund_ccca_due_in_cents integer,
  refund_grand_total_in_cents integer,
  status_code varchar(255),
  status_by_id integer,
  created_at timestamp(6) without time zone NOT NULL,
  updated_at timestamp(6) without time zone NOT NULL,
  request_by_home_phone varchar(255) -- verify against production (used by Rails model, absent from schema.rb and migrations; nullability/type unknown)
);

CREATE TABLE withdrawal_records (
  id serial PRIMARY KEY,
  student_id integer,
  school_year_id integer,
  grade_id integer,
  school_class_id integer,
  elective_class_id integer,
  registration_date date,
  withdrawal_date date,
  created_at timestamp(6) without time zone,
  updated_at timestamp(6) without time zone
);

CREATE INDEX index_school_class_active_flags_on_school_class_id ON school_class_active_flags (school_class_id);
CREATE INDEX index_school_class_active_flags_on_school_year_id ON school_class_active_flags (school_year_id);
CREATE INDEX index_student_class_assignments_on_school_year_id ON student_class_assignments (school_year_id);
