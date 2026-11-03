import { ForgotRequest } from './ForgotRequest'

export function ForgotPasswordPage() {
  return (
    <ForgotRequest
      path="/auth/forgot-password"
      field="username"
      label="field.username"
      title="forgotPassword.title"
      done="forgotPassword.done"
    />
  )
}
