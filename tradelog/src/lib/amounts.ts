import { createContext, useContext } from 'react'
import { axisMoneyFormatter, formatMoney, formatQuantity, formatSignedMoney } from './format.ts'

export const MONEY_MASK = '•••••'
const QUANTITY_MASK = '••'

const shown = {
  hidden: false,
  money: formatMoney,
  signedMoney: formatSignedMoney,
  quantity: formatQuantity,
  axisMoney: axisMoneyFormatter,
}

type Amounts = typeof shown

// The real values never reach the page, so they can't show in a tooltip or a
// screen reader. Percentages and share prices stay: alone they give away nothing.
const masked: Amounts = {
  hidden: true,
  money: () => MONEY_MASK,
  signedMoney: () => MONEY_MASK,
  quantity: () => QUANTITY_MASK,
  axisMoney: () => () => MONEY_MASK,
}

/** True while amounts are hidden; App provides it from Settings. */
export const AmountsHidden = createContext(false)

/** Formatters for money and share counts that respect "Hide amounts". */
export function useAmounts(): Amounts {
  return useContext(AmountsHidden) ? masked : shown
}
