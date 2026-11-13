import { ForgotRequest } from './ForgotRequest'

export function ForgotUsernamePage() {
  return (
    <ForgotRequest
      path="/auth/forgot-username"
      field="email"
      label="field.email"
      title="forgotUsername.title"
      done="forgotUsername.done"
    />
  )
}
