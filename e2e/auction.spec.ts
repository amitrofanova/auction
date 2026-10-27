import { expect, test } from '@playwright/test'

test('два окна торгуют одним лотом и сходятся после обрыва сети', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  await pageA.goto('/')
  await pageB.goto('/')
  await pageB.getByTestId('participant').selectOption('b')

  await expect(pageA.getByTestId('connection')).toHaveText('подключено')
  await expect(pageB.getByTestId('connection')).toHaveText('подключено')
  await expect(pageA.getByTestId('online-count')).toHaveAttribute('data-count', '2')
  await expect(pageB.getByTestId('you')).toHaveText('Марина')

  await pageA.getByTestId('bid-submit').click()
  await expect(pageA.getByTestId('leader-name')).toHaveText('Алексей')
  await expect(pageB.getByTestId('leader-name')).toHaveText('Алексей')
  await expect(pageB.getByTestId('leader-amount')).toHaveAttribute('data-amount', '10000')

  await pageB.getByTestId('broker-max').fill('30000')
  await pageB.getByTestId('broker-on').click()
  await expect(pageB.getByTestId('broker-status')).toContainText('Включён')
  await expect(pageA.getByTestId('leader-name')).toHaveText('Марина')
  await expect(pageA.getByTestId('leader-amount')).toHaveAttribute('data-amount', '10500')

  await pageA.getByTestId('bid-amount').fill('11000')
  await pageA.getByTestId('bid-submit').click()
  await expect(pageA.getByTestId('leader-name')).toHaveText('Марина')
  await expect(pageA.getByTestId('leader-amount')).toHaveAttribute('data-amount', '11500')
  await expect(pageB.getByTestId('leader-amount')).toHaveAttribute('data-amount', '11500')
  await expect(pageB.getByTestId('bid-list')).toContainText('авто')

  await contextB.setOffline(true)
  await expect(pageB.getByTestId('connection')).toHaveText('восстанавливаем')

  await pageA.getByTestId('bid-amount').fill('12000')
  await pageA.getByTestId('bid-submit').click()
  await expect(pageA.getByTestId('leader-amount')).toHaveAttribute('data-amount', '12500')

  await contextB.setOffline(false)
  await expect(pageB.getByTestId('leader-name')).toHaveText('Марина')
  await expect(pageB.getByTestId('leader-amount')).toHaveAttribute('data-amount', '12500')
  await expect(pageB.getByTestId('recovery-banner')).toHaveText(
    'соединение потеряно, состояние восстановлено',
  )

  const endsAt = await pageA.getByTestId('timer').getAttribute('data-ends-at')
  await expect(pageB.getByTestId('timer')).toHaveAttribute('data-ends-at', endsAt ?? '')
  const bids = await pageA.getByTestId('bid-count').getAttribute('data-count')
  await expect(pageB.getByTestId('bid-count')).toHaveAttribute('data-count', bids ?? '')

  await contextA.close()
  await contextB.close()
})
