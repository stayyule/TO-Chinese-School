import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Form, Input, Popconfirm, Space, Table, Tag, Typography } from 'antd'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiJson } from '../../api/client'
import { useMe } from '../../auth/useMe'
import { t } from '../../i18n'
import { PATHS } from '../../routes/paths'
import { NotFound } from '../NotFound'
import { QueryBoundary } from '../QueryBoundary'
import { FormError } from '../parent/fields'
import { useIdParam } from '../parent/helpers'
import { fill, requiredRule } from '../public/shared'
import { useFormSubmit } from '../useFormSubmit'

interface RoleUser {
  id: number
  username: string | null
  personName: string | null
}

interface RoleDetail {
  id: number
  name: string | null
  permissions: string[]
  users: RoleUser[]
}

const roleKey = (id: number) => ['roles', id] as const

function AddUserForm({ roleId }: { roleId: number }) {
  const [form] = Form.useForm<{ username: string }>()
  const queryClient = useQueryClient()
  const { busy, error, notFound, submit } = useFormSubmit(
    form,
    (v) => apiJson(`/roles/${roleId}/users`, { method: 'POST', body: JSON.stringify({ username: v.username.trim() }) }),
    {
      targets: { USER_NOT_FOUND: { field: ['username'], key: 'roles.userNotFound' } },
      onSuccess: async () => {
        form.resetFields()
        await queryClient.invalidateQueries({ queryKey: roleKey(roleId) })
      },
    },
  )
  if (notFound) return <NotFound />
  return (
    <Form form={form} layout="inline" onFinish={(v) => void submit(v)} disabled={busy} style={{ marginBottom: 16 }}>
      <FormError message={error} />
      <Form.Item name="username" label={t('field.username')} rules={[requiredRule]}>
        <Input autoComplete="off" maxLength={255} />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>
        {t('roles.addUser')}
      </Button>
    </Form>
  )
}

function RemoveUser({ roleId, user }: { roleId: number; user: RoleUser }) {
  const queryClient = useQueryClient()
  const inflight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const remove = async () => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true)
    setFailed(false)
    try {
      await apiJson(`/roles/${roleId}/users/${user.id}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: roleKey(roleId) })
    } catch {
      setFailed(true)
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }
  return (
    <Space>
      <Popconfirm
        title={fill('roles.removeConfirm', { user: user.username ?? String(user.id) })}
        okText={t('roles.removeYes')}
        cancelText={t('family.cancel')}
        onConfirm={() => void remove()}
      >
        <Button danger loading={busy}>
          {t('roles.remove')}
        </Button>
      </Popconfirm>
      {failed && <Typography.Text type="danger">{t('common.genericError')}</Typography.Text>}
    </Space>
  )
}

function RoleDetails({ role }: { role: RoleDetail }) {
  const { can } = useMe()
  const manage = can('access.roles.manage_users')
  return (
    <>
      <Typography.Title level={3}>{role.name ?? String(role.id)}</Typography.Title>
      <Link to={PATHS.adminRoles}>{t('roles.title')}</Link>
      <Typography.Title level={4}>{t('roles.permissions')}</Typography.Title>
      {role.permissions.length === 0 ? (
        <Typography.Paragraph type="secondary">{t('roles.noPermissions')}</Typography.Paragraph>
      ) : (
        <Space wrap>
          {role.permissions.map((p) => (
            <Tag key={p}>{p}</Tag>
          ))}
        </Space>
      )}
      <Typography.Title level={4}>{t('roles.users')}</Typography.Title>
      {manage && <AddUserForm roleId={role.id} />}
      <Table
        rowKey="id"
        dataSource={role.users}
        pagination={false}
        locale={{ emptyText: t('roles.noUsers') }}
        columns={[
          { title: t('field.username'), dataIndex: 'username' },
          { title: t('roles.person'), dataIndex: 'personName', render: (n: string | null) => (n ? <span>{n}</span> : null) },
          ...(manage ? [{ title: '', key: 'remove', render: (_: unknown, u: RoleUser) => <RemoveUser roleId={role.id} user={u} /> }] : []),
        ]}
      />
    </>
  )
}

function RoleLoader({ roleId }: { roleId: number }) {
  const query = useQuery({ queryKey: roleKey(roleId), queryFn: () => apiJson<RoleDetail>(`/roles/${roleId}`) })
  return <QueryBoundary query={query}>{(role) => <RoleDetails role={role} />}</QueryBoundary>
}

export function RoleDetailPage() {
  const roleId = useIdParam('roleId')
  if (roleId === null) return <NotFound />
  return <RoleLoader roleId={roleId} />
}
