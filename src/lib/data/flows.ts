export type Stage = {
  id: string
  title: string
  description: string
  roles: string[]
  menuPaths: string[]
  docs: { title: string; url: string }[]
  pitfalls: string[]
  prerequisites: string[]
  tables: string[]
  /** Conditional-FK / polymorphic badge, e.g. "conditional FK — requires AccountCode" */
  relations?: { from: string; to: string; note?: string; fields?: string[]; badge?: string }[]
  approvals?: string[]
  /** What this stage posts, and what it deliberately does not. Presence means "authored";
   *  absence means "not yet reviewed" — the two are different and the UI must not conflate
   *  them. An authored stage with an empty `creates` genuinely posts nothing. */
  impact?: {
    /** Journals / transactions / documents this action writes. Must exist in `stage.tables`. */
    creates?: string[]
    /** Tables a reader would reasonably expect this action to write, and which it does not.
     *  Need not be in `stage.tables` — that absence is the point. */
    doesNot?: string[]
  }
  /** Off the happy path: a branch, not a mandatory sequential step */
  optional?: boolean
}

export type Flow = {
  id: string
  title: string
  summary: string
  module: string
  stages: Stage[]
  edges: { from: string; to: string }[]
}

export type TableField = {
  name: string
  /** e.g. "Int64", "String", "Enum", "RecId", "Date" */
  type: string
  /** Target table name if this is a FK/RecId reference */
  fkTarget?: string
  /** Plain-English description of what this field means in business context */
  note: string
}

export type TableDef = {
  name: string
  /** One-liner describing what this table stores in business terms */
  description: string
  /** D365FO module this table primarily belongs to */
  module: string
  fields: TableField[]
  docsUrl?: string
}

export const roles = [
  'All',
  'Sales',
  'CSR',
  'Warehouse',
  'AR',
  'AP',
  'Buyer',
  'Controller',
  'Planner',
  'Production',
  'Project',
  'Service',
  'HR',
  'IT'
]

export const modules = [
  'All',
  'Sales',
  'Procurement',
  'Production',
  'Inventory',
  'Project',
  'Finance',
  'HR',
  'Service'
]

export const flows: Flow[] = [
  {
    id: 'otc',
    title: 'Order to Cash',
    summary: 'Quote to invoice to cash collection for customer sales.',
    module: 'Sales',
    stages: [
      {
        id: 'quote',
        title: 'Create Quote',
        description: 'Capture a customer offer with pricing, validity dates, and item lines before converting to a sales order.',
        roles: ['Sales'],
        menuPaths: ['Sales and marketing > Sales quotes > All sales quotes'],
        docs: [
          {
            title: 'Sales quotations overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/tasks/create-edit-sales-quotations'
          },
          {
            title: 'Trade agreements (price/discount)',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/price-simulation'
          }
        ],
        pitfalls: [
          'A zero credit limit blocks only when CustTable.MandatoryCreditLimit = Yes — an unset limit is not a zero-limit block',
          'Price/discount agreement not active for the quote date — wrong price pulled',
          'Expiry date not set — quote stays open indefinitely',
        ],
        prerequisites: ['Customer account (CustTable)', 'Price/discount agreement (optional)'],
        tables: ['SalesQuotationTable', 'SalesQuotationLine', 'CustTable', 'PriceDiscTable', 'PriceDiscAdmTrans'],
        relations: [
          {
            from: 'SalesQuotationTable',
            to: 'CustTable',
            fields: ['SalesQuotationTable.CustAccount → CustTable.AccountNum'],
            note: 'Quote header references the customer being quoted',
          },
          {
            from: 'SalesQuotationLine',
            to: 'SalesQuotationTable',
            fields: ['SalesQuotationLine.QuotationId → SalesQuotationTable.QuotationId'],
            note: 'Each quote line belongs to its parent quote header',
          },
          {
            from: 'SalesQuotationLine',
            to: 'InventTable',
            fields: ['SalesQuotationLine.ItemId → InventTable.ItemId'],
            note: 'Quote lines reference released products in the item master',
          },
          {
            from: 'PriceDiscAdmTrans',
            to: 'PriceDiscTable',
            fields: ['PriceDiscAdmTrans.PriceDiscTableRef → PriceDiscTable.RecId'],
            note: 'Active trade-agreement lines are stored in PriceDiscAdmTrans; PriceDiscTableRef is the actual reference to the price/discount journal source row',
          },
        ],
        approvals: ['Quote approval workflow'],
      },
      {
        id: 'so',
        title: 'Create Sales Order',
        description: 'Convert a quote (or create directly) into a sales order, setting delivery dates, dimensions, and inventory reservations. Confirmation is a separate posting event.',
        roles: ['Sales'],
        menuPaths: ['Sales and marketing > Sales orders > All sales orders'],
        docs: [
          {
            title: 'Create sales orders',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/tasks/create-sales-orders',
          },
          {
            title: 'Sales orders overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/overview-sales-marketing',
          },
        ],
        pitfalls: [
          'Delivery terms or mode of delivery not set on the order',
          'InventDim mismatch: site/warehouse required fields not defaulted',
          'SalesTable.InvoiceAccount ≠ CustAccount — the invoice goes to a different customer than the order',
        ],
        prerequisites: ['Released product (InventTable)', 'Site and warehouse configured'],
        tables: ['SalesTable', 'SalesLine', 'CustTable', 'InventDim', 'InventTable', 'AgreementHeader', 'AgreementLine', 'SalesAgreementHeader'],
        relations: [
          {
            from: 'SalesTable',
            to: 'CustTable',
            fields: ['SalesTable.CustAccount → CustTable.AccountNum'],
            note: 'Order header links to the ordering customer; SalesTable.InvoiceAccount may point to a different billing customer',
          },
          {
            from: 'SalesLine',
            to: 'SalesTable',
            fields: ['SalesLine.SalesId → SalesTable.SalesId'],
            note: 'Each sales line belongs to its parent order header',
          },
          {
            from: 'SalesLine',
            to: 'InventTable',
            fields: ['SalesLine.ItemId → InventTable.ItemId'],
            note: 'Lines reference released products in the item master',
          },
          {
            from: 'SalesLine',
            to: 'InventDim',
            fields: ['SalesLine.InventDimId → InventDim.inventDimId'],
            note: 'InventDimId is a system-generated hash that encodes the combination of site, warehouse, batch, serial, and tracking dimensions for the line',
          },
          {
            from: 'SalesTable',
            to: 'AgreementHeader',
            fields: ['SalesTable.MatchingAgreement → AgreementHeader.RecId'],
            badge: 'conditional FK — requires AgreementClassification = the sales classification',
            note: 'A sales order can be released against an agreement; MatchingAgreement references the generic AgreementHeader, whose AgreementClassification discriminates the agreement type (SalesAgreementHeader is the sales subtype that carries CustAccount and SalesNumberSequence)',
          },
          {
            from: 'AgreementLine',
            to: 'AgreementHeader',
            fields: ['AgreementLine.Agreement → AgreementHeader.RecId'],
            note: 'Each AgreementLine specifies a quantity or value commitment for one item under the parent AgreementHeader',
          },
        ],
        approvals: ['Configured customer credit check'],
      },
      {
        id: 'confirm',
        title: 'Confirm Sales Order',
        description: 'Post the order confirmation to the customer. This is the posting event that creates CustConfirmJour/CustConfirmTrans — order entry itself does not produce them.',
        roles: ['CSR'],
        menuPaths: ['Sales and marketing > Sales orders > All sales orders'],
        docs: [
          {
            title: 'Confirm sales orders',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/tasks/confirm-sales-orders',
          },
        ],
        pitfalls: [
          'CustTable.Blocked, CreditMax, MandatoryCreditLimit and CreditRating determine whether confirmation or posting is held — a configured credit check, not a manual approval on every order',
          'Confirmation posting is skipped when the order is already confirmed — CustConfirmJour holds one row per confirmation posting, not one per order',
        ],
        prerequisites: ['Sales order created', 'Confirmation print/Posting setup (Print management)'],
        tables: ['SalesTable', 'CustConfirmJour', 'CustConfirmTrans'],
        relations: [
          {
            from: 'CustConfirmJour',
            to: 'SalesTable',
            fields: ['CustConfirmJour.SalesId → SalesTable.SalesId'],
            note: 'Posting a sales order confirmation creates a CustConfirmJour header with CustConfirmTrans lines',
          },
          {
            from: 'CustConfirmTrans',
            to: 'CustConfirmJour',
            fields: ['CustConfirmTrans.ConfirmId → CustConfirmJour.ConfirmId', 'CustConfirmTrans.SalesId → SalesTable.SalesId'],
            note: 'Line detail for a sales order confirmation; one row per confirmed order line, with SalesId retained as order context',
          },
        ],
      },
      {
        id: 'pickpack',
        title: 'Pick / Pack / Ship',
        description: 'Reserve inventory, generate warehouse work orders, pick, pack, and ship goods to the customer.',
        roles: ['Warehouse'],
        menuPaths: [
          'Warehouse management > Work > All work',
          'Warehouse management > Shipments > All shipments',
          'Warehouse management > Loads > All loads',
        ],
        docs: [
          {
            title: 'Warehouse management overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/warehousing/warehouse-management-overview',
          },
          {
            title: 'Wave processing',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/warehousing/wave-processing',
          },
        ],
        pitfalls: [
          'Reservation hierarchy blocks batch/serial from being auto-reserved',
          'Wave template or work template not configured for the warehouse',
          'Location directive not covering the item type or zone',
        ],
        prerequisites: ['Location directives', 'Work templates', 'Wave templates'],
        tables: ['WHSWorkTable', 'WHSWorkLine', 'WHSShipmentTable', 'WHSLoadTable', 'InventTrans', 'InventTransOrigin', 'WMSPickingRoute', 'CustPackingSlipJour', 'CustPackingSlipTrans'],
        relations: [
          {
            from: 'WHSWorkLine',
            to: 'WHSWorkTable',
            fields: ['WHSWorkLine.WorkId → WHSWorkTable.WorkId'],
            note: 'Work lines belong to a work order header',
          },
          {
            from: 'WHSWorkTable',
            to: 'WHSShipmentTable',
            fields: ['WHSWorkTable.ShipmentId → WHSShipmentTable.ShipmentId'],
            note: 'Work is generated for a specific outbound shipment',
          },
          {
            from: 'WHSShipmentTable',
            to: 'WHSLoadTable',
            fields: ['WHSShipmentTable.LoadId → WHSLoadTable.LoadId'],
            note: 'One or more shipments are consolidated onto a load for transport planning',
          },
          {
            from: 'WHSWorkTable',
            to: 'SalesTable',
            fields: ['WHSWorkTable.OrderNum = SalesTable.SalesId'],
            note: 'Work is traceable back to the originating sales order',
          },
          {
            from: 'WHSWorkLine',
            to: 'InventTransOrigin',
            fields: ['WHSWorkLine.InventTransId → InventTransOrigin.InventTransId'],
            note: 'There is no direct WHSWorkLine → InventTrans FK. Work lines carry the inventory transaction id, and InventTransOrigin is the identity record that ties it to the item, dimensions and source document',
          },
          {
            from: 'InventTrans',
            to: 'InventTransOrigin',
            fields: ['InventTrans.InventTransOrigin → InventTransOrigin.RecId'],
            note: 'The second hop of the path: InventTrans references InventTransOrigin by RecId, so WHSWorkLine → InventTransOrigin → InventTrans reaches the inventory transactions. StatusIssue goes Picked → Sold when the invoice is posted',
          },
          {
            from: 'CustPackingSlipJour',
            to: 'SalesTable',
            fields: ['CustPackingSlipJour.SalesId = SalesTable.SalesId'],
            note: 'Posted delivery note header created when goods are physically shipped to the customer; has financial impact on inventory (COGS posting)',
          },
          {
            from: 'CustPackingSlipTrans',
            to: 'CustPackingSlipJour',
            fields: ['CustPackingSlipTrans.PackingSlipId = CustPackingSlipJour.PackingSlipId', 'CustPackingSlipTrans.SalesId = SalesTable.SalesId'],
            note: 'Line detail for a delivery note; one row per shipped item line',
          },
          {
            from: 'CustPackingSlipTrans',
            to: 'InventTransOrigin',
            fields: ['CustPackingSlipTrans.InventTransId → InventTransOrigin.InventTransId'],
            note: 'Shipped lines reach InventTrans through InventTransOrigin by inventory transaction id, not by a direct FK',
          },
        ],
      },
      {
        id: 'invoice',
        title: 'Post Invoice',
        description: 'Generate and post a customer invoice — from a sales order or as a free-text invoice — creating the AR subledger (CustTrans) and the general-ledger entries.',
        roles: ['AR'],
        menuPaths: [
          'Sales and marketing > Sales orders > All sales orders',
          'Accounts receivable > Invoices > All free text invoices',
        ],
        docs: [
          {
            title: 'Customer invoicing',
            url: 'https://learn.microsoft.com/dynamics365/finance/accounts-receivable/configure-customer-invoices',
          },
          {
            title: 'Sales tax overview',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/indirect-taxes-overview',
          },
        ],
        pitfalls: [
          'Posting profile missing for the customer group — invoice post will error',
          'Sales tax group / item tax group mismatch produces wrong tax amount',
          'CustInvoiceTable/CustInvoiceLine are pending free-text invoice records; CustInvoiceJour/CustInvoiceTrans are posted invoice records. Free-text invoices are not sourced from SalesTable/SalesLine',
        ],
        prerequisites: ['Customer posting profiles', 'Sales tax codes and groups'],
        tables: ['CustInvoiceJour', 'CustInvoiceTrans', 'CustInvoiceTable', 'CustInvoiceLine', 'CustTrans', 'TaxTrans', 'GeneralJournalEntry', 'GeneralJournalAccountEntry', 'SubledgerVoucherGeneralJournalEntry', 'SpecTrans', 'TaxTable', 'TaxGroupHeading', 'TaxItemGroupHeading'],
        relations: [
          {
            from: 'CustInvoiceJour',
            to: 'SalesTable',
            fields: ['CustInvoiceJour.SalesId → SalesTable.SalesId'],
            note: 'Posted invoice header references the originating sales order; free-text invoices leave SalesId empty',
          },
          {
            from: 'CustInvoiceTrans',
            to: 'CustInvoiceJour',
            fields: ['CustInvoiceTrans.ParentRecId → CustInvoiceJour.RecId'],
            note: 'Invoice lines belong to their posted invoice header via ParentRecId',
          },
          {
            from: 'CustInvoiceTrans',
            to: 'SalesTable',
            fields: ['CustInvoiceTrans.SalesId = SalesTable.SalesId'],
            note: 'Each invoice line traces back to the originating sales order',
          },
          {
            from: 'CustInvoiceLine',
            to: 'CustInvoiceTable',
            fields: ['CustInvoiceLine.ParentRecId → CustInvoiceTable.RecId'],
            note: 'Pending free-text invoice lines belong to their unposted CustInvoiceTable header; posting moves them to CustInvoiceJour/CustInvoiceTrans',
          },
          {
            from: 'CustInvoiceJour',
            to: 'CustTrans',
            fields: ['CustTrans.Invoice = CustInvoiceJour.InvoiceId', 'CustTrans.AccountNum = CustInvoiceJour.InvoiceAccount'],
            note: 'Posting creates an open CustTrans debit record; it stays open until payment and settlement close it. The AR account is the invoiced account, which may differ from the ordering account',
          },
          {
            from: 'CustInvoiceJour',
            to: 'SubledgerVoucherGeneralJournalEntry',
            fields: ['CustInvoiceJour.LedgerVoucher → SubledgerVoucherGeneralJournalEntry.Voucher'],
            note: 'Match the posted AR voucher to the subledger/GL bridge; preserve company context when matching',
          },
          {
            from: 'SubledgerVoucherGeneralJournalEntry',
            to: 'GeneralJournalEntry',
            fields: ['SubledgerVoucherGeneralJournalEntry.GeneralJournalEntry → GeneralJournalEntry.RecId'],
            note: 'The subledger voucher resolves to exactly one posted GL journal header',
          },
          {
            from: 'GeneralJournalAccountEntry',
            to: 'GeneralJournalEntry',
            fields: ['GeneralJournalAccountEntry.GeneralJournalEntry → GeneralJournalEntry.RecId'],
            note: 'Debit/credit lines of the posted GL voucher — the AR control account debit and the revenue/tax credits',
          },
          {
            from: 'CustTrans',
            to: 'TaxTrans',
            fields: ['TaxTrans.Voucher = CustTrans.Voucher'],
            note: 'Tax transactions share the same voucher number as the AR customer transaction',
          },
          {
            from: 'TaxTrans',
            to: 'TaxTable',
            fields: ['TaxTrans.TaxCode = TaxTable.TaxCode'],
            note: 'Tax code (TaxTable) is assigned to SalesLine and CustInvoiceLine via TaxGroup; TaxTrans.TaxCode references TaxTable.TaxCode for each posted tax transaction',
          },
          {
            from: 'CustTable',
            to: 'TaxGroupHeading',
            fields: ['CustTable.TaxGroup = TaxGroupHeading.TaxGroup', 'SalesLine.TaxGroup = TaxGroupHeading.TaxGroup'],
            note: 'Sales tax group (TaxGroupHeading) is assigned to a customer, vendor, or order header; TaxGroup field on SalesLine/CustInvoiceLine references TaxGroupHeading.TaxGroup',
          },
          {
            from: 'SalesLine',
            to: 'TaxItemGroupHeading',
            fields: ['SalesLine.TaxItemGroup = TaxItemGroupHeading.TaxItemGroup'],
            note: 'Item sales tax group (TaxItemGroupHeading) is assigned to items or order lines; TaxItemGroup field on SalesLine/CustInvoiceLine references TaxItemGroupHeading.TaxItemGroup',
          },
        ],
        approvals: ['Invoice review workflow (optional)'],
      },
      {
        id: 'returns',
        title: 'Process Return / Credit Note',
        optional: true,
        description: 'Optional branch: the customer returns goods or the invoice is corrected. A return order is a SalesTable row with SalesType = Return Order, and the posted correction shows up as a credit note against the original invoice.',
        roles: ['Sales', 'Warehouse', 'AR'],
        menuPaths: [
          'Sales and marketing > Sales returns > All return orders',
        ],
        docs: [
          {
            title: 'Returns overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/returns-overview',
          },
        ],
        pitfalls: [
          'ReturnDispositionCode drives what happens to the goods (credit only, scrap, replace) — it is disposition context, not a table link',
          'A credit note is a posted CustInvoiceJour row with IsCorrection set and ReversedRecId pointing at the original invoice — not a delete of the original',
        ],
        prerequisites: ['Return reason codes', 'Original posted invoice (for a credit note)'],
        tables: ['SalesTable', 'SalesLine', 'ReturnReasonCode', 'CustInvoiceJour', 'CustInvoiceTrans', 'CustTrans', 'CustSettlement'],
        relations: [
          {
            from: 'SalesTable',
            to: 'ReturnReasonCode',
            fields: ['SalesTable.ReturnReasonCodeId → ReturnReasonCode.ReasonCodeId'],
            note: 'A return order carries its reason code; ReturnStatus tracks the return lifecycle on the same SalesTable row',
          },
          {
            from: 'CustInvoiceJour',
            to: 'CustInvoiceJour',
            fields: ['CustInvoiceJour.ReversedRecId → CustInvoiceJour.RecId'],
            note: 'The credit note points back at the invoice it reverses; IsCorrection marks the posted correction and ReturnItemNum ties it to the returned line',
          },
        ],
      },
      {
        id: 'payment',
        title: 'Receive Payment',
        description: 'Enter, post, and settle customer payment against the open invoice, clearing the AR balance.',
        roles: ['AR'],
        menuPaths: [
          'Accounts receivable > Payments > Customer payment journal',
          'Accounts receivable > Transactions > Settle open transactions',
        ],
        docs: [
          {
            title: 'Customer payment overview',
            url: 'https://learn.microsoft.com/dynamics365/finance/accounts-receivable/accounts-receivable',
          },
          {
            title: 'Settlement overview',
            url: 'https://learn.microsoft.com/dynamics365/finance/cash-bank-management/settlement-overview',
          },
        ],
        pitfalls: [
          'Method of payment not configured for the bank account',
          'Auto-settlement not enabled in AR parameters — payment posts but invoice stays open',
          'Bank reconciliation timing: payment posted but not yet matched on bank statement',
          'Open-item state lives in CustTransOpen, not on CustTrans — CustTrans has Closed, there is no Open field',
        ],
        prerequisites: ['Bank account (BankAccountTable)', 'Method of payment'],
        tables: ['CustTrans', 'CustTransOpen', 'CustSettlement', 'SpecTrans', 'LedgerJournalTable', 'LedgerJournalTrans', 'BankAccountTable', 'BankAccountTrans', 'CashDisc'],
        relations: [
          {
            from: 'LedgerJournalTrans',
            to: 'LedgerJournalTable',
            fields: ['LedgerJournalTrans.JournalNum → LedgerJournalTable.JournalNum'],
            note: 'Payment journal lines belong to the payment journal header',
          },
          {
            from: 'LedgerJournalTrans',
            to: 'CustTrans',
            fields: ['LedgerJournalTrans.Voucher → CustTrans.Voucher (after posting)'],
            note: 'Posting the payment journal creates a CustTrans credit record that offsets the invoice debit',
          },
          {
            from: 'CustTransOpen',
            to: 'CustTrans',
            fields: ['CustTransOpen.RefRecId → CustTrans.RecId'],
            note: 'CustTransOpen carries the open-item state — due date, amount still open, cash discount date and collection letter code — for the CustTrans transaction it references',
          },
          {
            from: 'CustSettlement',
            to: 'CustTrans',
            fields: ['CustSettlement.TransRecId → CustTrans.RecId (invoice transaction)', 'CustSettlement.OffsetRecid → CustTrans.RecId (payment transaction)'],
            note: 'CustSettlement is the linking record between the invoice CustTrans and payment CustTrans; settling closes both records',
          },
          {
            from: 'SpecTrans',
            to: 'CustTrans',
            fields: ['SpecTrans.SpecRecId + SpecTrans.SpecTableId → CustTrans.RecId (polymorphic — requires the table id pair and company context)'],
            badge: 'polymorphic — requires SpecTableId + SpecRecId + company',
            note: 'Polymorphic, not a direct FK: SpecTrans records which transactions a journal line marks for settlement, so SpecRecId/SpecTableId and RefRecId/RefTableId must be read as a pair together with SpecCompany/RefCompany',
          },
          {
            from: 'LedgerJournalTrans',
            to: 'BankAccountTable',
            fields: ['LedgerJournalTrans.PaymentAccount → BankAccountTable.AccountID'],
            note: 'Payment journal line specifies which bank account receives the cash (referenced via PaymentAccount/BankAccountId)',
          },
          {
            from: 'BankAccountTrans',
            to: 'BankAccountTable',
            fields: ['BankAccountTrans.AccountId = BankAccountTable.AccountID'],
            note: 'Each payment journal posting creates a BankAccountTrans row against the bank account',
          },
          {
            from: 'CustTrans',
            to: 'CashDisc',
            fields: ['CustTrans.CashDiscCode = CashDisc.CashDiscCode', 'VendTrans.CashDiscCode = CashDisc.CashDiscCode'],
            note: 'Cash discount schedule defining % discount if paid within N days; referenced by CustTrans and VendTrans during settlement',
          },
        ],
      },
      {
        id: 'collections',
        title: 'Manage Overdue Receivables',
        optional: true,
        description: 'Optional branch: the invoice is not paid by its due date. Collection letters and interest notes chase the overdue balance; recovery is still settled in the payment stage.',
        roles: ['AR', 'Controller'],
        menuPaths: [
          'Accounts receivable > Credit and collections > Collection letter',
          'Accounts receivable > Credit and collections > Interest',
        ],
        docs: [
          {
            title: 'Collections and credit in Accounts receivable',
            url: 'https://learn.microsoft.com/dynamics365/finance/accounts-receivable/collections-credit-accounts-receivable',
          },
          {
            title: 'Customer interest and collection letters',
            url: 'https://learn.microsoft.com/dynamics365/finance/accounts-receivable/tasks/process-collection-letters',
          },
        ],
        pitfalls: [
          'Collection letter sequence or interest code not configured — the posting run produces nothing',
          'Overdue is derived from CustTransOpen.DueDate, not from the invoice date — payment terms decide when an item becomes delinquent',
        ],
        prerequisites: ['Collection letter sequences', 'Interest codes', 'Posting profiles'],
        tables: ['CustTrans', 'CustTransOpen', 'CustCollectionLetterJour', 'CustInterestJour', 'CustInterest', 'PaymTerm'],
        relations: [
          {
            from: 'CustTransOpen',
            to: 'CustTrans',
            fields: ['CustTransOpen.RefRecId → CustTrans.RecId'],
            note: 'Only open items are chased; CustTransOpen supplies the due date and the amount still outstanding',
          },
          {
            from: 'CustCollectionLetterJour',
            to: 'CustTable',
            fields: ['CustCollectionLetterJour.AccountNum → CustTable.AccountNum'],
            note: 'One collection letter journal row per customer per letter code, carrying the letter number, date and fee',
          },
          {
            from: 'CustInterestJour',
            to: 'CustTable',
            fields: ['CustInterestJour.AccountNum → CustTable.AccountNum'],
            note: 'Interest note posted against the customer for the overdue amount; PaymTermId holds the terms the interest was calculated from',
          },
        ],
      },
    ],
    edges: [
      { from: 'quote', to: 'so' },
      { from: 'so', to: 'confirm' },
      { from: 'confirm', to: 'pickpack' },
      { from: 'pickpack', to: 'invoice' },
      { from: 'invoice', to: 'payment' },
      { from: 'invoice', to: 'returns' },
      { from: 'invoice', to: 'collections' },
      { from: 'collections', to: 'payment' },
    ],
  },
  {
    id: 'p2p',
    title: 'Procure to Pay',
    summary: 'Request, purchase, receive, and pay vendors.',
    module: 'Procurement',
    stages: [
      {
        id: 'req',
        title: 'Create Requisition',
        description: 'Request items/services for approval.',
        roles: ['Buyer', 'CSR'],
        menuPaths: ['Procurement and sourcing > Purchase requisitions'],
        docs: [
          {
            title: 'Purchase requisitions overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-requisitions-overview'
          }
        ],
        pitfalls: ['Financial dimensions missing', 'Catalog access not set'],
        prerequisites: ['Vendors and products released', 'Financial dimensions'],
        tables: ['PurchReqTable', 'PurchReqLine', 'VendTable', 'DimensionAttributeValueCombination', 'PurchReqTableHistory'],
        impact: {
          creates: ['PurchReqTable', 'PurchReqLine', 'PurchReqTableHistory'],
          doesNot: ['PurchTable', 'VendTrans'],
        },
        approvals: ['Requisition approval workflow']
      },
      {
        id: 'po',
        title: 'Issue Purchase Order',
        description: 'Convert approved req or create PO direct. Approval workflow commits the order internally; telling the supplier is a separate confirmation step, and the two are not the same event.',
        roles: ['Buyer'],
        menuPaths: ['Procurement and sourcing > Purchase orders > All purchase orders'],
        docs: [
          {
            title: 'Purchase orders overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-order-overview'
          }
        ],
        pitfalls: ['Vendor delivery terms missing', 'Ordering vendor and invoice vendor confused — OrderAccount and InvoiceAccount are separate FKs and may point at different vendors'],
        prerequisites: ['Vendor, terms, charges, taxes'],
        tables: ['PurchTable', 'PurchLine', 'VendTable', 'TaxGroupHeading', 'MarkupAutoTable', 'AgreementHeader', 'AgreementLine', 'PurchTableHistory', 'PurchLineHistory'],
        impact: {
          creates: ['PurchTable', 'PurchLine', 'PurchTableHistory', 'PurchLineHistory'],
          doesNot: ['VendTrans', 'InventTrans', 'VendPackingSlipJour'],
        },
        relations: [
          {
            from: 'PurchTable',
            to: 'VendTable',
            fields: ['PurchTable.OrderAccount = VendTable.AccountNum'],
            badge: 'declared FK',
            note: 'OrderAccount identifies the supplier receiving the PO; InvoiceAccount identifies the vendor to invoice and may differ',
          },
          {
            from: 'PurchTable',
            to: 'VendTable',
            fields: ['PurchTable.InvoiceAccount = VendTable.AccountNum'],
            badge: 'declared FK',
            note: 'A second, independent vendor FK on the same header (AOT relation InvoiceVendor): with third-party billing the AP creditor is InvoiceAccount, not OrderAccount',
          },
          {
            from: 'PurchLine',
            to: 'InventTable',
            fields: ['PurchLine.ItemId = InventTable.ItemId'],
            note: 'PO line references released product',
          },
          {
            from: 'PurchTable',
            to: 'AgreementHeader',
            fields: ['PurchTable.MatchingAgreement = AgreementHeader.RecId'],
            note: 'A purchase order can be released against a purchase agreement; PurchTable.MatchingAgreement FK references AgreementHeader.RecId (purchase agreement classification) to inherit agreed pricing',
          },
          {
            from: 'AgreementLine',
            to: 'AgreementHeader',
            fields: ['AgreementLine.Agreement = AgreementHeader.RecId'],
            note: 'Each AgreementLine specifies a quantity or value commitment for one item under the parent AgreementHeader',
          },
        ],
        approvals: ['PO approval workflow']
      },
      {
        id: 'confirm',
        title: 'Confirm Purchase Order',
        description: 'Confirm the approved PO as a document action, then print/send it to the supplier; confirmation advances PurchStatus on PurchTable to Backorder. This build has no PurchConfirmJour/PurchConfirmTrans confirmation journal, so confirmation is not a posted journal row — the sales-side CustConfirmJour split does not transfer here. Where purchase order change management is enabled, amendments are versioned history rows and may require reapproval or reconfirmation; check the configured policy.',
        roles: ['Buyer'],
        menuPaths: ['Procurement and sourcing > Purchase orders > All purchase orders'],
        docs: [
          {
            title: 'Purchase orders overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-order-overview'
          }
        ],
        pitfalls: [
          'Confirmation modelled as a posted journal — no PurchConfirmJour/PurchConfirmTrans exists in this build',
          'Confirmed but never sent: PurchStatus advancing does not prove the supplier received the order',
          'Post-confirmation amendment without change management reruns approval — where change management is on, each version is a PurchTableHistory/PurchLineHistory row',
        ],
        prerequisites: ['PO approved', 'Print management / vendor contact destination'],
        tables: ['PurchTable', 'PurchLine', 'PurchTableHistory', 'PurchLineHistory'],
        impact: {
          creates: [],
          doesNot: ['VendPackingSlipJour', 'VendTrans'],
        },
        relations: [
          {
            from: 'PurchTable',
            to: 'PurchTableHistory',
            fields: ['PurchTableHistory.PurchId = PurchTable.PurchId'],
            badge: 'declared FK',
            note: 'With change management enabled each PO version is a dated history row (ValidFrom/ValidTo) against the same PurchId, not an overwrite of the live header',
          },
          {
            from: 'PurchLineHistory',
            to: 'PurchTableHistory',
            fields: ['PurchLineHistory.PurchId = PurchTableHistory.PurchId'],
            badge: 'declared FK',
            note: 'Line-level version history attaches to the header version by PurchId (AOT relation exists); the line number itself has no declared relation — pairing it with PurchLine.LineNumber is a business-key match',
          },
        ],
      },
      {
        id: 'receipt',
        title: 'Product Receipt',
        description: 'Receive goods/services and update on-hand. Posting the receipt is the action on the purchase order; the product receipt journal is the posted result you review afterwards.',
        roles: ['Warehouse'],
        menuPaths: ['Procurement and sourcing > Purchase orders > All purchase orders > Receive > Product receipt'],
        docs: [
          {
            title: 'Product receipts against purchase orders',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/procurement/product-receipt-against-purchase-orders'
          }
        ],
        pitfalls: ['Unit mismatch vs invoice'],
        prerequisites: ['Item model group', 'Unit conversions'],
        tables: ['PurchTable', 'PurchLine', 'VendPackingSlipJour', 'VendPackingSlipTrans', 'InventTrans'],
        impact: {
          creates: ['VendPackingSlipJour', 'VendPackingSlipTrans', 'InventTrans'],
          doesNot: ['VendTrans', 'VendSettlement', 'GeneralJournalEntry'],
        },
        relations: [
          {
            from: 'VendPackingSlipJour',
            to: 'PurchTable',
            fields: ['VendPackingSlipJour.PurchId = PurchTable.PurchId'],
            badge: 'declared FK',
            note: 'Posted receipt header belongs to the purchase order it was received against',
          },
        ],
      },
      {
        id: 'vendor-invoice',
        title: 'Vendor Invoice',
        description: 'Match invoice to receipt and post liabilities. Invoice matching can be disabled, two-way (PO/invoice), or three-way (PO/receipt/invoice), depending on the active configuration. Check vendor/item policy, invoice-matching parameters, and price/quantity tolerances; variance handling may warn or block posting. Posting creates the AP liability and clears receipt accrual as configured; review the posted voucher/GL lines afterwards.',
        roles: ['AP'],
        menuPaths: ['Accounts payable > Invoices > Pending vendor invoices'],
        docs: [
          {
            title: 'Vendor invoices overview',
            url: 'https://learn.microsoft.com/dynamics365/finance/accounts-payable/vendor-invoices-overview'
          }
        ],
        pitfalls: [
          'Tax code mismatch',
          'Vendor posting profile missing or invalid; invoice posting may fail',
          'Invoice match variance exceeds the configured tolerance or is blocked by policy',
          'VendInvoiceTrans.LineNum is a decimal LineNum, not the PO line number — match PO lines on PurchID + PurchaseLineLineNumber, and it is a field match, not a declared FK',
          'Active matching setup precedence is not documented here: confirm the effective policy in the target environment before diagnosing a failed match',
        ],
        prerequisites: ['Vendor posting profiles', 'Tax groups', 'Invoice matching policy and tolerances'],
        tables: ['VendInvoiceJour', 'VendInvoiceTrans', 'VendTrans', 'TaxTrans', 'SubledgerVoucherGeneralJournalEntry', 'GeneralJournalEntry', 'GeneralJournalAccountEntry', 'VendInvoiceInfoTable', 'VendInvoiceInfoLine', 'PurchTable', 'PurchLine', 'VendTable', 'VendItemMatchingPolicy', 'VendInvoiceMatching', 'VendParameters'],
        impact: {
          creates: ['VendInvoiceJour', 'VendInvoiceTrans', 'VendTrans', 'TaxTrans', 'SubledgerVoucherGeneralJournalEntry', 'GeneralJournalEntry', 'GeneralJournalAccountEntry'],
          doesNot: ['VendPackingSlipJour', 'InventTrans', 'VendSettlement'],
        },
        relations: [
          {
            from: 'VendInvoiceTrans',
            to: 'PurchLine',
            fields: ['VendInvoiceTrans.PurchID = PurchLine.PurchId', 'VendInvoiceTrans.PurchaseLineLineNumber = PurchLine.LineNumber'],
            badge: 'field match — not a declared FK',
            note: 'Match PO id plus the real PO line number (both sides TradeLineNumber, Int64). VendInvoiceTrans.LineNum is a Real LineNum and is not the PO line number; no AOT relation exists for this pair',
          },
          {
            from: 'VendInvoiceJour',
            to: 'PurchTable',
            fields: ['VendInvoiceJour.PurchId = PurchTable.PurchId'],
            badge: 'declared FK',
            note: 'Posted vendor invoice header references the purchase order it was posted from',
          },
          {
            from: 'VendInvoiceInfoTable',
            to: 'PurchTable',
            fields: ['VendInvoiceInfoTable.PurchId = PurchTable.PurchId'],
            badge: 'declared FK',
            note: 'Pending vendor invoice header before posting; posting creates VendInvoiceJour',
          },
          {
            from: 'VendInvoiceInfoTable',
            to: 'VendTable',
            fields: ['VendInvoiceInfoTable.OrderAccount = VendTable.AccountNum'],
            badge: 'declared FK',
            note: 'Ordering/submitting vendor (AOT relation VendTable_OrderAccount); may differ from the invoice creditor',
          },
          {
            from: 'VendInvoiceInfoTable',
            to: 'VendTable',
            fields: ['VendInvoiceInfoTable.InvoiceAccount = VendTable.AccountNum'],
            badge: 'declared FK',
            note: 'Creditor/invoice vendor (AOT relation VendTable_InvoiceAccount) — the party the invoice actually credits',
          },
          {
            from: 'VendInvoiceInfoLine',
            to: 'VendInvoiceInfoTable',
            fields: ['VendInvoiceInfoLine.ParmId = VendInvoiceInfoTable.ParmId'],
            badge: 'declared FK',
            note: 'Pending invoice line to header via the posting session key; keep separate from the PO-line relation',
          },
          {
            from: 'VendInvoiceInfoLine',
            to: 'PurchLine',
            fields: ['VendInvoiceInfoLine.PurchLineRecId = PurchLine.RecId'],
            badge: 'declared FK',
            note: 'Valid declared FK from the pending invoice line to the PO line being invoiced',
          },
          {
            from: 'VendInvoiceJour',
            to: 'SubledgerVoucherGeneralJournalEntry',
            fields: ['VendInvoiceJour.LedgerVoucher = SubledgerVoucherGeneralJournalEntry.Voucher'],
            badge: 'field match — no declared AOT relation',
            note: 'Match the posted AP voucher to the subledger/GL bridge; preserve company context when matching',
          },
          {
            from: 'SubledgerVoucherGeneralJournalEntry',
            to: 'GeneralJournalEntry',
            fields: ['SubledgerVoucherGeneralJournalEntry.GeneralJournalEntry = GeneralJournalEntry.RecId'],
            badge: 'declared FK',
            note: 'The bridge points to the posted GL journal header',
          },
          {
            from: 'GeneralJournalAccountEntry',
            to: 'GeneralJournalEntry',
            fields: ['GeneralJournalAccountEntry.GeneralJournalEntry = GeneralJournalEntry.RecId'],
            badge: 'declared FK',
            note: 'GL account-entry lines provide the debit/credit detail for review',
          },
        ],
        approvals: ['Invoice approval workflow']
      },
      {
        id: 'returns',
        title: 'Return Order / Vendor Credit',
        optional: true,
        description: 'Optional branch: goods go back to the vendor or the invoice is corrected. The certain route is a return PO with negative quantities — confirm it, post product receipt for the return shipment, then post and settle the vendor credit note as applicable. TransactionReversalTrans is the generic reversal-lineage table (RefTableId + RefRecId); whether it stores AP invoice reversals in this build is unverified, so it is not modelled as an AP relation.',
        roles: ['Buyer', 'Warehouse', 'AP'],
        menuPaths: [
          'Procurement and sourcing > Purchase orders > All purchase orders',
          'Accounts payable > Invoices > Pending vendor invoices',
        ],
        docs: [
          {
            title: 'Create a purchase return order',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/procurement/tasks/create-purchase-return-order'
          },
        ],
        pitfalls: [
          'Return PO line quantities must be negative; a positive line is a new supply order, not a return',
          'VendInvoiceJour has no IsCorrection/ReversedRecId field in this build — a posted PO invoice is corrected with a vendor credit note, not by reversing the journal',
          'TransactionReversalTrans is generic; AP invoice usage is unverified, so do not report it as an AP reversal link',
        ],
        prerequisites: ['Original posted invoice or receipt', 'Return reason / disposition'],
        tables: ['PurchTable', 'PurchLine', 'VendPackingSlipJour', 'VendPackingSlipTrans', 'VendInvoiceJour', 'VendInvoiceTrans', 'VendTrans', 'VendSettlement'],
        impact: {
          creates: ['PurchTable', 'PurchLine', 'VendPackingSlipJour', 'VendPackingSlipTrans', 'VendInvoiceJour', 'VendInvoiceTrans', 'VendTrans'],
          doesNot: ['VendSettlement'],
        },
        relations: [
          {
            from: 'VendPackingSlipJour',
            to: 'PurchTable',
            fields: ['VendPackingSlipJour.PurchId = PurchTable.PurchId'],
            badge: 'declared FK',
            note: 'Posted return receipt belongs to the return PO',
          },
          {
            from: 'VendPackingSlipTrans',
            to: 'VendPackingSlipJour',
            fields: ['VendPackingSlipTrans.VendPackingSlipJour = VendPackingSlipJour.RecId'],
            badge: 'declared FK',
            note: 'Receipt lines under the posted receipt header',
          },
        ],
      },
      {
        id: 'vendor-payment',
        title: 'Vendor Payment',
        description: 'Propose and settle vendor payments. A payment proposal (VendPaymProposalEdit) generates and edits the payment journal from due open items; manual payment journal entry in Accounts payable > Payments > Payment journal is a separate route to the same posting. Payment posts to bank/cash and settles the vendor open item.',
        roles: ['AP'],
        menuPaths: [
          'Accounts payable > Payments > Payment journal',
        ],
        docs: [
          {
            title: 'Vendor payment overview',
            url: 'https://learn.microsoft.com/dynamics365/finance/cash-bank-management/tasks/vendor-payment-overview'
          }
        ],
        pitfalls: [
          'Method of payment / bank not set',
          'Settlement parameters wrong',
          'Open-item state lives in VendTransOpen, not on VendTrans — VendTrans has Closed, there is no Open field',
          'Payment proposal and manual journal are different entry routes; a proposal not transferred/posted leaves the journal unposted',
        ],
        prerequisites: ['Bank account', 'Method of payment', 'Vendor terms'],
        tables: ['VendTrans', 'VendTransOpen', 'VendSettlement', 'LedgerJournalTable', 'LedgerJournalTrans', 'BankAccountTable', 'BankAccountTrans'],
        impact: {
          creates: ['LedgerJournalTable', 'LedgerJournalTrans', 'VendSettlement', 'VendTrans', 'BankAccountTrans'],
          doesNot: ['VendInvoiceJour', 'PurchTable'],
        },
        relations: [
          {
            from: 'VendTransOpen',
            to: 'VendTrans',
            fields: ['VendTransOpen.RefRecId = VendTrans.RecId'],
            badge: 'declared FK',
            note: 'Open-item due date and remaining amount live on VendTransOpen; the proposal and settlement run read this table, not a VendTrans.Open field',
          },
          {
            from: 'LedgerJournalTrans',
            to: 'LedgerJournalTable',
            fields: ['LedgerJournalTrans.JournalNum = LedgerJournalTable.JournalNum'],
            badge: 'declared FK',
            note: 'Payment journal lines belong to the payment journal header',
          },
          {
            from: 'LedgerJournalTrans',
            to: 'BankAccountTable',
            fields: ['LedgerJournalTrans.PaymentAccount = BankAccountTable.AccountID'],
            badge: 'declared FK',
            note: 'Payment journal line pays from / into this bank account',
          },
        ],
      }
    ],
    edges: [
      { from: 'req', to: 'po' },
      { from: 'po', to: 'confirm' },
      { from: 'confirm', to: 'receipt' },
      { from: 'receipt', to: 'vendor-invoice' },
      { from: 'vendor-invoice', to: 'vendor-payment' },
      { from: 'vendor-invoice', to: 'returns' },
      { from: 'returns', to: 'vendor-payment' }
    ]
  },
  {
    id: 'ptp',
    title: 'Plan to Produce',
    summary: 'Forecast, plan, firm, execute production, and cost it.',
    module: 'Production',
    stages: [
      {
        id: 'forecast',
        title: 'Forecast / Master Plan',
        description: 'Create demand forecasts and run master planning.',
        roles: ['Planner'],
        menuPaths: [
          'Master planning > Forecasting > Manual forecast entry > Demand forecast lines',
          'Master planning > Master planning > Run > Master planning',
        ],
        docs: [
          {
            title: 'Demand forecasting setup',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/master-planning/demand-forecasting-setup'
          }
        ],
        pitfalls: ['Coverage groups missing', 'Forecast model not selected'],
        prerequisites: ['Coverage groups', 'Forecast model', 'Master plan'],
        tables: ['ForecastModel', 'ForecastSales', 'ReqPlan', 'ReqPlanSched', 'ReqPlanVersion', 'ReqTrans', 'ReqPO'],
        relations: [
          {
            from: 'ReqTrans',
            to: 'ReqPlanVersion',
            fields: ['ReqTrans.PlanVersion = ReqPlanVersion.RecId'],
            badge: 'declared FK',
            note: 'Planned transactions belong to a master plan version (planning run); forecast lines feed planned orders',
          },
          {
            from: 'ReqPO',
            to: 'PurchTable',
            fields: ['ReqPO.PurchId = PurchTable.PurchId'],
            badge: 'declared FK',
            note: 'Planned purchase orders firm into POs; the planned order carries the PurchId it will firm into',
          },
          {
            from: 'ForecastSales',
            to: 'ForecastModel',
            fields: ['ForecastSales.ModelId = ForecastModel.ModelId'],
            badge: 'conditional FK — requires ForecastModel.Type = HeadingSub::Heading',
            note: 'Every demand forecast line belongs to a forecast model; the master plan consumes models, not loose lines. The relation fixes Type = Heading, so join with that predicate or sub-models come back too. ForecastSales.ModelId and ForecastModel.ModelId differ in EDT: ForecastModelHeadId on this side, ForecastModelId on the model',
          },
          {
            from: 'ReqPlan',
            to: 'ForecastModel',
            fields: ['ReqPlan.ForecastModelId = ForecastModel.ModelId'],
            badge: 'conditional FK — requires ForecastModel.Type = HeadingSub::Heading',
            note: 'The plan header names the forecast model it reduces against. ReqPlan.ForecastModelId has EDT ForecastModelHeadId — not a self-reference. ReqPlanSched and ReqPlanVersion are children of ReqPlan, not the header. The relation fixes ForecastModel.Type = Heading, so filter it or sub-models come back',
          },
        ],
      },
      {
        id: 'bom',
        title: 'BOM / Route',
        description: 'Model materials and operations.',
        roles: ['Production'],
        menuPaths: [
          'Product information management > Bills of materials and formulas > Bills of materials',
          'Production control > Setup > Routes > Operations',
        ],
        docs: [
          {
            title: 'Bills of materials and formulas',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/production-control/bill-of-material-bom'
          }
        ],
        pitfalls: ['Resource group capacity not set', 'BOM version not approved/activated'],
        prerequisites: ['Resources, resource groups, calendars', 'Cost groups'],
        tables: ['BOMTable', 'BOMVersion', 'RouteVersion', 'RouteTable', 'RouteOpr', 'WrkCtrTable', 'ReqItemTable', 'InventTable'],
        relations: [
          {
            from: 'BOMVersion',
            to: 'BOMTable',
            fields: ['BOMVersion.BOMId = BOMTable.BOMId'],
            badge: 'declared FK',
            note: 'Approved/activated BOM versions reference the BOM header; BOM holds the version lines',
          },
          {
            from: 'RouteOpr',
            to: 'RouteTable',
            fields: ['RouteOpr.RouteRelation = RouteTable.RouteId'],
            badge: 'conditional FK — requires RouteCode = Route',
            note: 'Operations tied to the route header; the AOT relation fixes RouteCode = RouteAll::Route, so an unfiltered navigation also returns the non-route rows of the same relation id',
          },
          {
            from: 'RouteVersion',
            to: 'InventTable',
            fields: ['RouteVersion.ItemId = InventTable.ItemId'],
            badge: 'declared FK',
            note: 'Route versions bind a route to an item for a date and quantity range; this is the item-to-route assignment',
          },
          {
            from: 'RouteVersion',
            to: 'RouteTable',
            fields: ['RouteVersion.RouteId = RouteTable.RouteId'],
            badge: 'declared FK',
            note: 'The route header a version versions; operations hang off RouteOpr under this route',
          },
        ],
      },
      {
        id: 'firm',
        title: 'Firm Planned Orders',
        description: 'Firm planned orders into real production, purchase, transfer, or journal documents (Master planning), then estimate and schedule that new production order before release (Production control). Two modules, two separate actions — not one screen.',
        roles: ['Planner', 'Production'],
        menuPaths: [
          'Master planning > Master planning > Run > Planned order firming',
          'Production control > Periodic tasks > Production order status update > Estimation',
          'Production control > Periodic tasks > Scheduling > Operations scheduling',
          'Production control > Periodic tasks > Scheduling > Job scheduling',
        ],
        docs: [
          {
            title: 'Planned orders and firming',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/master-planning/planned-orders'
          }
        ],
        pitfalls: ['Planned order journal not set up for the order type', 'Estimation fails on missing cost categories'],
        prerequisites: ['Approved BOM/route and coverage setup', 'Number sequences for the firmed order type'],
        tables: ['ReqPlan', 'ReqTransFirmLog', 'ProdTable', 'PurchTable', 'InventTransferTable', 'InventJournalTable'],
        relations: [
          {
            from: 'ReqTransFirmLog',
            to: 'ProdTable',
            fields: ['ReqTransFirmLog.InventTransId = ProdTable.InventTransId', 'ReqTransFirmLog.InventTransRefId = ProdTable.ProdId'],
            badge: 'polymorphic — requires InventTransType',
            note: 'Firmed production order; only rows with InventTransType = Production resolve here',
          },
          {
            from: 'ReqTransFirmLog',
            to: 'PurchTable',
            fields: ['ReqTransFirmLog.InventTransRefId = PurchTable.PurchId'],
            badge: 'polymorphic — requires InventTransType',
            note: 'Firmed purchase order; only rows with InventTransType = Purch resolve here',
          },
          {
            from: 'ReqTransFirmLog',
            to: 'InventTransferTable',
            fields: ['ReqTransFirmLog.InventTransRefId = InventTransferTable.TransferId'],
            badge: 'polymorphic — requires InventTransType',
            note: 'Firmed transfer order; only rows with InventTransType = Transfer resolve here',
          },
          {
            from: 'ReqTransFirmLog',
            to: 'InventJournalTable',
            fields: ['ReqTransFirmLog.InventTransRefId = InventJournalTable.JournalId'],
            badge: 'polymorphic — requires InventTransType',
            note: 'Firmed inventory journal; only rows with InventTransType = Journal resolve here',
          },
          {
            from: 'ReqTransFirmLog',
            to: 'ReqPlan',
            fields: ['ReqTransFirmLog.ReqPlanId = ReqPlan.ReqPlanId'],
            badge: 'declared FK',
            note: 'The firming log records which master plan the requirement was fired from; this is the evidence that firming happened',
          },
        ],
      },
      {
        id: 'release',
        title: 'Release to Warehouse',
        description: 'Release planned/firmed orders to execution.',
        roles: ['Production', 'Warehouse'],
        menuPaths: [
          'Production control > Production orders > All production orders',
          'Production control > Periodic tasks > Production order status update > Release',
        ],
        docs: [
          {
            title: 'Production process overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/production-control/production-process-overview'
          }
        ],
        pitfalls: ['Reservation hierarchies wrong', 'Route operation times missing'],
        prerequisites: ['Route/BOM approved', 'Warehouse parameters set'],
        tables: ['ProdTable', 'ProdBOM', 'ProdRoute', 'WHSWorkTable', 'InventTrans', 'WHSLoadTable'],
        relations: [
          {
            from: 'ProdBOM',
            to: 'BOM',
            fields: ['ProdBOM.BOMRefRecId = BOM.RecId'],
            badge: 'declared FK',
            note: 'Production order BOM line references the BOM line it was copied from; BOM is the BOM line table, not a BOM version',
          },
          {
            from: 'ProdBOM',
            to: 'ProdTable',
            fields: ['ProdBOM.ProdId = ProdTable.ProdId'],
            badge: 'declared FK',
            note: 'Consumed component lines belong to the production order',
          },
          {
            from: 'ProdBOM',
            to: 'BOMVersion',
            fields: ['ProdBOM.BOMId = BOMVersion.BOMId'],
            badge: 'field match — not a declared FK',
            note: 'The BOM version the order was exploded from; ProdBOM has no declared relation to BOMVersion, only the shared BOMId EDT',
          },
          {
            from: 'ProdRoute',
            to: 'RouteOpr',
            fields: ['ProdRoute.RouteOprRefRecId = RouteOpr.RecId'],
            badge: 'declared FK',
            note: 'Route copied to production order; each production route line references the route operation it was copied from',
          },
          {
            from: 'ProdRoute',
            to: 'ProdTable',
            fields: ['ProdRoute.ProdId = ProdTable.ProdId'],
            badge: 'declared FK',
            note: 'Production route lines belong to the production order',
          },
          {
            from: 'WHSWorkTable',
            to: 'ProdTable',
            fields: ['WHSWorkTable.OrderNum = ProdTable.ProdId'],
            badge: 'conditional FK — requires WorkTransType (ProdTablePick vs ProdTablePut)',
            note: 'Two declared relations share OrderNum → ProdId: ProdTablePick and ProdTablePut. A bare navigation returns put-away work for a picking question, so filter WorkTransType',
          },
          {
            from: 'InventTrans',
            to: 'WHSLoadTable',
            fields: ['InventTrans.LoadId = WHSLoadTable.LoadId'],
            badge: 'declared FK — outbound load header, not a production-order reference',
            note: 'Production output leaves through InventTrans, so a WMS-enabled put/load path keeps the load header reachable from this stage. WHSWorkTable.LoadId declares the same relation; both sides are EDT WHSLoadId',
          },
        ],
      },
      {
        id: 'execute',
        title: 'Execute / Report as Finished',
        description: 'Start, register, RAF, and end production.',
        roles: ['Production'],
        menuPaths: [
          'Production control > Production orders > All production orders',
          'Production control > Periodic tasks > Production order status update > Report as finished',
          'Production control > Adjustments > Picking list',
          'Production control > Adjustments > Route card',
        ],
        docs: [
          {
            title: 'Report production orders as finished',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/production-control/report-production-orders-as-finished'
          }
        ],
        pitfalls: ['Backflushing not set', 'License plate tracking mismatches'],
        prerequisites: ['Flushing principles', 'Operational resources and routes'],
        tables: ['ProdTable', 'ProdJournalTable', 'ProdJournalBOM', 'ProdJournalRoute', 'ProdJournalProd', 'ProdRouteJob', 'InventTrans'],
        relations: [
          {
            from: 'ProdJournalBOM',
            to: 'ProdTable',
            fields: ['ProdJournalBOM.ProdId = ProdTable.ProdId'],
            badge: 'declared FK',
            note: 'Picking-list (BOM consumption) journal lines consume components for this production order',
          },
          {
            from: 'ProdJournalBOM',
            to: 'ProdJournalTable',
            fields: ['ProdJournalBOM.JournalId = ProdJournalTable.JournalId'],
            badge: 'conditional FK — requires JournalType (Picklist for a picking-list journal)',
            note: 'Consumption lines belong to a production journal header; the AOT relation fixes JournalType = Picklist, so an unfiltered navigation also returns RAF and other journal types',
          },
          {
            from: 'ProdJournalBOM',
            to: 'InventTransOrigin',
            fields: ['ProdJournalBOM.InventTransId = InventTransOrigin.InventTransId'],
            badge: 'field match — EDT mismatch',
            note: 'Component consumption posts an inventory issue through the transaction origin, but ProdJournalBOM.InventTransId is EDT InventTransIdBase and InventTransOrigin.InventTransId is InventTransId — no declared relation, expect misses',
          },
          {
            from: 'ProdJournalProd',
            to: 'ProdTable',
            fields: ['ProdJournalProd.ProdId = ProdTable.ProdId'],
            badge: 'declared FK',
            note: 'Production journals tied to order',
          },
          {
            from: 'ProdJournalProd',
            to: 'InventTransOrigin',
            fields: ['ProdJournalProd.InventTransId = InventTransOrigin.InventTransId'],
            badge: 'declared FK',
            note: 'RAF and consumption update inventory transactions via the inventory transaction origin',
          },
          {
            from: 'ProdJournalRoute',
            to: 'ProdRouteJob',
            fields: ['ProdJournalRoute.JobId = ProdRouteJob.JobId'],
            badge: 'declared FK',
            note: 'Route card lines report time and quantity against a specific route job; this is the operation-feedback link',
          },
          {
            from: 'ProdJournalRoute',
            to: 'ProdTable',
            fields: ['ProdJournalRoute.ProdId = ProdTable.ProdId'],
            badge: 'declared FK',
            note: 'Route card journal lines belong to the production order being reported',
          },
        ],
      },
      {
        id: 'cost',
        title: 'Cost and Close',
        description: 'End job, post cost, and reconcile variances.',
        roles: ['Controller'],
        menuPaths: [
          'Production control > Periodic tasks > Production order status update > End',
          'Inventory management > Periodic tasks > Closing and adjustment',
          'Production control > Inquiries and reports > Cost analysis reports > Cost estimates and costings',
        ],
        docs: [
          {
            title: 'Production order cost analysis',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/cost-management/production-order-cost-analysis'
          }
        ],
        pitfalls: ['Costing version not active', 'Inventory close blocked'],
        prerequisites: ['Costing version', 'Inventory close schedule'],
        tables: ['ProdCalcTrans', 'InventClosing', 'InventSettlement', 'InventTrans', 'SubledgerVoucherGeneralJournalEntry', 'GeneralJournalEntry'],
        relations: [
          {
            from: 'ProdCalcTrans',
            to: 'ProdTable',
            fields: ['ProdCalcTrans.TransRefId = ProdTable.ProdId', 'ProdCalcTrans.CollectRefProdId = ProdTable.CollectRefProdId'],
            badge: 'declared FK',
            note: 'Production costing by order. ProdCalcTrans has no ProdId field — the declared Table and CollectRefProdId relations carry both pairs. TransRefId EDT CostTransRefId; holds a ProdId only when TransRefType = Production',
          },
          {
            from: 'InventSettlement',
            to: 'InventClosing',
            fields: ['InventSettlement.Voucher = InventClosing.Voucher', 'InventSettlement.TransDate = InventClosing.TransDate'],
            badge: 'declared FK',
            note: 'The close run is the header and the settlements belong to it; the relation constrains both voucher and transaction date. Declared as a plain AxTableRelation (RelationshipType Association), not AxTableRelationForeignKey. Date EDTs differ: InventSettlement.TransDate is DatePosted, InventClosing.TransDate is TransDate',
          },
          {
            from: 'InventSettlement',
            to: 'InventTrans',
            fields: ['InventSettlement.TransRecId = InventTrans.RecId'],
            badge: 'declared FK',
            note: 'Each settlement row settles one inventory transaction',
          },
          {
            from: 'InventSettlement',
            to: 'SubledgerVoucherGeneralJournalEntry',
            fields: ['InventSettlement.Voucher = SubledgerVoucherGeneralJournalEntry.Voucher'],
            badge: 'field match — not a declared FK',
            note: 'Shared Voucher only — no AOT relation and no fk-map edge. Voucher only — not unique without VoucherDataAreaId + AccountingDate: InventSettlement.TransDate is EDT DatePosted while AccountingDate is TransDate, so a bare Voucher join crosses companies and dates. Use the next hop to reach the GL header',
          },
          {
            from: 'SubledgerVoucherGeneralJournalEntry',
            to: 'GeneralJournalEntry',
            fields: ['SubledgerVoucherGeneralJournalEntry.GeneralJournalEntry = GeneralJournalEntry.RecId'],
            badge: 'declared FK',
            note: 'The subledger/GL bridge row resolves to the GeneralJournalEntry header — this is the honest settlement-to-GL hop',
          },
        ],
      }
    ],
    edges: [
      { from: 'forecast', to: 'bom' },
      { from: 'bom', to: 'firm' },
      { from: 'firm', to: 'release' },
      { from: 'release', to: 'execute' },
      { from: 'execute', to: 'cost' }
    ]
  },
  {
    id: 'inv',
    title: 'Inventory & Costing',
    summary: 'Set up items, manage on-hand, move, count, and close.',
    module: 'Inventory',
    stages: [
      {
        id: 'setup',
        title: 'Item Setup',
        description: 'Dimensions, tracking, and storage policies.',
        roles: ['Warehouse', 'Controller'],
        menuPaths: ['Product information management > Products > Released products'],
        docs: [
          {
            title: 'Product information overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/pim/product-information'
          }
        ],
        pitfalls: ['Dimension group wrong for scenario', 'Tracking not aligned with WMS'],
        prerequisites: ['Storage/tracking dimension groups', 'Item model group'],
        tables: ['InventTable', 'InventTableModule', 'InventModelGroup', 'InventModelGroupItem', 'InventDim', 'EcoResProduct', 'EcoResCategory', 'EcoResCategoryHierarchy', 'InventItemGroup', 'InventItemGroupItem'],
        relations: [
          {
            from: 'InventTable',
            to: 'EcoResProduct',
            fields: ['InventTable.Product → EcoResProduct.RecId'],
            badge: 'declared FK',
            note: 'Released product (per legal entity) links back to the shared global product definition. AOT relation EcoResProduct',
          },
          {
            from: 'InventTableModule',
            to: 'InventTable',
            fields: ['InventTableModule.ItemId → InventTable.ItemId'],
            badge: 'declared FK',
            note: 'Up to three rows per item (ModuleType 1/2/3) carry module-specific unit, price, and discount. AOT relation InventTable',
          },
          {
            from: 'InventModelGroupItem',
            to: 'InventModelGroup',
            fields: ['InventModelGroupItem.ModelGroupId = InventModelGroup.ModelGroupId'],
            badge: 'declared FK',
            note: 'Item model group assigned per item (InventModelGroupItem); determines costing method (FIFO/StdCost/etc.) and physical/financial posting policy. AOT relation InventModelGroup also constrains ModelGroupDataAreaId as the legal-entity qualifier',
          },
          {
            from: 'InventModelGroupItem',
            to: 'InventTable',
            fields: ['InventModelGroupItem.ItemId = InventTable.ItemId'],
            badge: 'declared FK',
            note: 'The item-to-model-group assignment itself. AOT relation InventTable also constrains ItemDataAreaId as the company qualifier',
          },
          {
            from: 'EcoResCategory',
            to: 'EcoResCategoryHierarchy',
            fields: ['EcoResCategory.CategoryHierarchy = EcoResCategoryHierarchy.RecId'],
            badge: 'declared FK',
            note: 'Product category node in a hierarchy; products assigned via EcoResProductCategory. AOT relation EcoResCategoryHierarchy',
          },
          {
            from: 'InventItemGroupItem',
            to: 'InventItemGroup',
            fields: ['InventItemGroupItem.ItemGroupId = InventItemGroup.ItemGroupId'],
            badge: 'declared FK',
            note: 'Item group assigned per item (InventItemGroupItem); drives inventory posting profile and tax item groups. AOT relation InventItemGroup also constrains ItemGroupDataAreaId as the legal-entity qualifier',
          },
          {
            from: 'InventItemGroupItem',
            to: 'InventTable',
            fields: ['InventItemGroupItem.ItemId = InventTable.ItemId'],
            badge: 'declared FK',
            note: 'The item-to-item-group assignment itself. AOT relation InventTable also constrains ItemDataAreaId as the company qualifier',
          },
        ],
      },
      {
        id: 'onhand',
        title: 'On-hand and Reservations',
        description: 'Monitor availability and reservations.',
        roles: ['Warehouse', 'Sales', 'Planner'],
        menuPaths: ['Inventory management > Inquiries and reports > On-hand list'],
        docs: [
          {
            title: 'Inventory on-hand list',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/inventory/inventory-on-hand-list'
          }
        ],
        pitfalls: ['Reservation hierarchies conflicting', 'Negative inventory settings wrong'],
        prerequisites: ['Reservation hierarchies', 'Coverage groups'],
        tables: ['InventSum', 'WHSInventReserve', 'InventDim', 'WHSReservationHierarchy'],
        relations: [
          {
            from: 'InventSum',
            to: 'InventDim',
            badge: 'declared FK',
            note: 'On-hand summary per dimension. AOT relation InventDim, declared on InventDimId → inventDimId',
            fields: ['InventSum.InventDimId = InventDim.InventDimId']
          },
          {
            from: 'WHSInventReserve',
            to: 'InventDim',
            badge: 'declared FK',
            note: 'Warehouse reservation per LP/location. AOT relation InventDim is explicitly declared on InventDimId → inventDimId even though WHSInventReserve has no fk-map.json edge — the generated map omits the table, the source relation does not',
            fields: ['WHSInventReserve.InventDimId = InventDim.InventDimId']
          }
        ]
      },
      {
        id: 'movement',
        title: 'Transfer / Movement',
        description: 'Transfers across sites/warehouses/locations.',
        roles: ['Warehouse'],
        menuPaths: ['Inventory management > Inbound orders > Transfer order'],
        docs: [
          {
            title: 'Transfer orders',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/warehousing/create-transfer-order-from-warehouse-app'
          }
        ],
        pitfalls: ['In-transit warehouse missing', 'Dimensions not aligned on transfer'],
        prerequisites: ['Transfer orders setup', 'In-transit settings'],
        tables: ['InventTransferTable', 'InventTransferLine', 'InventTrans', 'InventTransOrigin', 'WHSWorkTable', 'WHSLoadTable'],
        relations: [
          {
            from: 'InventTransferLine',
            to: 'InventTransferTable',
            fields: ['InventTransferLine.TransferId = InventTransferTable.TransferId'],
            badge: 'declared FK',
            note: 'Transfer line belongs to the transfer order header. AOT relation InventTransferTable',
          },
          {
            from: 'InventTransferLine',
            to: 'InventTransOrigin',
            fields: [
              'InventTransferLine.InventTransId = InventTransOrigin.InventTransId',
              'InventTransferLine.InventTransIdReceive = InventTransOrigin.InventTransId',
              'InventTransferLine.InventTransIdScrap = InventTransOrigin.InventTransId',
              'InventTransferLine.InventTransIdTransitFrom = InventTransOrigin.InventTransId',
              'InventTransferLine.InventTransIdTransitTo = InventTransOrigin.InventTransId'
            ],
            badge: 'declared FK',
            note: 'Transfer posting creates one transaction origin per transfer role, all declared directly on InventTransferLine: AOT relations ShipmentInventTransOrigin (InventTransId), ReceiveInventTransOrigin (InventTransIdReceive), ScrapInventTransOrigin (InventTransIdScrap), TransitFromInventTransOrigin (InventTransIdTransitFrom), TransitToInventTransOrigin (InventTransIdTransitTo)',
          },
          {
            from: 'InventTrans',
            to: 'InventTransOrigin',
            fields: ['InventTrans.InventTransOrigin = InventTransOrigin.RecId'],
            badge: 'declared FK',
            note: 'Inventory transactions reach the transfer only through their origin record. AOT relation InventTransOrigin — there is no direct InventTrans ↔ InventTransferLine edge and no TransferId/ReferenceId join',
          },
          {
            from: 'WHSWorkTable',
            to: 'InventTransferTable',
            fields: ['WHSWorkTable.OrderNum = InventTransferTable.TransferId'],
            badge: 'conditional FK — requires WorkTransType = WHSWorkTransType::TransferIssue or WHSWorkTransType::TransferReceipt',
            note: 'If WMS, a transfer order generates warehouse work. Two AOT relations on the same field pair, gated by Fixed discriminator: TransferOrderIssue (WorkTransType = WHSWorkTransType::TransferIssue) and TransferOrderReciept (WorkTransType = WHSWorkTransType::TransferReceipt). Relation name spelled "Reciept" in AOT. No relation exists between InventTransferLine and WHSWorkTable',
          }
        ]
      },
      {
        id: 'count',
        title: 'Cycle Counting',
        description: 'Count and reconcile on-hand.',
        roles: ['Warehouse', 'Controller'],
        menuPaths: ['Inventory management > Journal entries > Item counting > Counting'],
        docs: [
          {
            title: 'Cycle counting',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/warehousing/cycle-counting'
          }
        ],
        pitfalls: ['Counting journals blocked by open work', 'Thresholds not set'],
        prerequisites: ['Counting groups', 'Work policy'],
        tables: ['WHSCycleCountPlan', 'WHSWorkLineCycleCount', 'InventJournalTable', 'InventJournalTrans'],
        relations: [
          {
            from: 'WHSWorkLineCycleCount',
            to: 'WHSWorkTable',
            fields: ['WHSWorkLineCycleCount.WorkId = WHSWorkTable.WorkId'],
            badge: 'declared FK',
            note: 'Cycle count plans generate count work; counted quantities are posted via counting journals (InventJournalTable/InventJournalTrans). AOT relation WHSWorkTable',
          },
          {
            from: 'InventJournalTrans',
            to: 'InventTransOrigin',
            fields: [
              'InventJournalTrans.InventTransId = InventTransOrigin.InventTransId',
              'InventJournalTrans.InventTransIdFather = InventTransOrigin.InventTransId',
              'InventJournalTrans.InventTransIdReturn = InventTransOrigin.InventTransId',
              'InventJournalTrans.ToInventTransId = InventTransOrigin.InventTransId'
            ],
            badge: 'declared FK',
            note: 'Posting creates inventory transactions via the inventory transaction origin. Four declared roles, the primary being AOT relation InventTransOrigin (InventTransId); the alternates are ParentInventTransOrigin (InventTransIdFather), ReturnInventTransOrigin (InventTransIdReturn) and ToInventTransOrigin (ToInventTransId)',
          },
        ],
      },
      {
        id: 'close',
        title: 'Inventory Close',
        description: 'Close period and settle receipts/issues.',
        roles: ['Controller'],
        menuPaths: ['Inventory management > Periodic tasks > Closing and adjustment'],
        docs: [
          {
            title: 'Inventory close',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-close'
          }
        ],
        pitfalls: ['Open production or transfers blocking'],
        prerequisites: ['All POs/SOs posted'],
        tables: ['InventSettlement', 'InventClosing', 'InventTrans', 'InventCostList', 'SubledgerVoucherGeneralJournalEntry'],
        relations: [
          {
            from: 'InventSettlement',
            to: 'InventTrans',
            fields: ['InventSettlement.TransRecId = InventTrans.RecId'],
            badge: 'declared FK',
            note: 'Close settles receipts/issues. AOT relation InventTrans',
          },
          {
            from: 'InventSettlement',
            to: 'InventClosing',
            fields: ['InventSettlement.Voucher = InventClosing.Voucher', 'InventSettlement.TransDate = InventClosing.TransDate'],
            badge: 'declared FK',
            note: 'The close run is the header and the settlements belong to it; the relation constrains both voucher and transaction date. Declared as a plain AxTableRelation (RelationshipType Association), not AxTableRelationForeignKey. Date EDTs differ: InventSettlement.TransDate is DatePosted, InventClosing.TransDate is TransDate',
          },
          {
            from: 'InventSettlement',
            to: 'SubledgerVoucherGeneralJournalEntry',
            fields: ['InventSettlement.Voucher = SubledgerVoucherGeneralJournalEntry.Voucher'],
            badge: 'field match — not a declared FK',
            note: 'Adjustments post to the ledger through the subledger/GL voucher bridge. No AOT relation in either direction and no fk-map edge: Voucher alone is unqualified and can cross companies and dates. The bridge also keys on VoucherDataAreaId + AccountingDate, which this row does not carry — use the InventClosing row for the close run, and InventSettlement.TransDate (EDT DatePosted) does not match AccountingDate (EDT TransDate), so treat any voucher-only match as unqualified',
          }
        ]
      }
    ],
    edges: [
      { from: 'setup', to: 'onhand' },
      { from: 'onhand', to: 'movement' },
      { from: 'movement', to: 'count' },
      { from: 'count', to: 'close' }
    ]
  },
  {
    id: 'proj',
    title: 'Project to Profit',
    summary: 'Quote, contract, deliver, and recognize revenue for projects.',
    module: 'Project',
    stages: [
      {
        id: 'proj-quote',
        title: 'Project Quotation',
        description: 'Scope and price the project quotation, complete its approval workflow, then confirm it from Periodic > Quotations and transfer some or all lines to a new or existing project; where needed, copy the quotation to a project forecast.',
        roles: ['Project', 'Sales'],
        menuPaths: ['Project management and accounting > Quotations'],
        docs: [
          {
            title: 'Project quotations',
            url: 'https://learn.microsoft.com/en-us/dynamics365/finance/project-management/project-quotations'
          }
        ],
        pitfalls: ['Funding source not set', 'Category setup incomplete'],
        prerequisites: ['Project groups', 'Categories', 'Funding sources'],
        tables: ['ProjTable', 'SalesQuotationTable', 'ProjGroup', 'ProjFundingSource', 'ProjInvoiceTable'],
        relations: [
          {
            from: 'SalesQuotationTable',
            to: 'ProjTable',
            fields: ['SalesQuotationTable.ProjIdRef = ProjTable.ProjId'],
            badge: 'declared FK',
            note: 'Project quotation references the project it was transferred to or created against.',
          },
          {
            from: 'SalesQuotationTable',
            to: 'ProjInvoiceTable',
            fields: ['SalesQuotationTable.ProjInvoiceProjId = ProjInvoiceTable.ProjInvoiceProjId'],
            badge: 'declared FK',
            note: 'Project quotation references its project billing contract.',
          },
        ],
        approvals: ['Quote approval workflow']
      },
      {
        id: 'proj-contract',
        title: 'Project Contract & WBS',
        description: 'Choose the project type and contract, define forecasts and budgets, then build and publish the WBS; project type determines downstream invoicing.',
        roles: ['Project'],
        menuPaths: ['Project management and accounting > Projects'],
        docs: [
          {
            title: 'Project contracts',
            url: 'https://learn.microsoft.com/en-us/dynamics365/finance/project-management/project-contracts'
          }
        ],
        pitfalls: ['WBS not published', 'Funding rules incomplete'],
        prerequisites: ['Project type', 'Project contract', 'Funding rules', 'Forecasts and budgets', 'WBS'],
        tables: ['ProjTable', 'ProjInvoiceTable', 'ProjFundingSource', 'ProjPlanVersion', 'ProjPlanVersionDetail', 'ProjLineProperty'],
        relations: [
          {
            from: 'ProjFundingSource',
            to: 'ProjInvoiceTable',
            fields: ['ProjFundingSource.ContractId = ProjInvoiceTable.ProjInvoiceProjId'],
            badge: 'declared FK',
            note: "Funding source ContractId is constrained to the project billing contract ProjInvoiceProjId.",
          },
          {
            from: 'ProjPlanVersionDetail',
            to: 'ProjTable',
            fields: ['ProjPlanVersionDetail.ProjId = ProjTable.ProjId'],
            badge: 'declared FK',
            note: 'WBS plan-version detail associates the hierarchy with its project.',
          },
          {
            from: 'ProjPlanVersionDetail',
            to: 'ProjPlanVersion',
            fields: ['ProjPlanVersionDetail.HierarchyId = ProjPlanVersion.HierarchyId'],
            badge: 'declared FK',
            note: 'Plain AxTableRelation field constraint (an association, not an AxTableRelationForeignKey): plan-version detail links to the task hierarchy in ProjPlanVersion.',
          },
        ],
      },
      {
        id: 'proj-exec',
        title: 'Execute & Track',
        description: 'Capture hours, expenses, and item consumption; complete required review, approval, and posting so project actuals are available for tracking and billing. Materials may flow through item requirements, purchase orders, and packing slips.',
        roles: ['Project'],
        menuPaths: ['Project management and accounting > Timesheets'],
        docs: [
          {
            title: 'Project transactions overview',
            url: 'https://learn.microsoft.com/dynamics365/project-operations/prod-pma/overview-project-management-accounting'
          }
        ],
        pitfalls: ['Category validation failing', 'Resource not assigned', 'Transactions not approved or posted'],
        prerequisites: ['Categories allowed on project', 'Worker setup'],
        tables: ['ProjEmplTrans', 'ProjItemTrans', 'ProjCostTrans', 'HcmWorker', 'ProjCategory', 'ResResourceIdentifier'],
        relations: [
          {
            from: 'ProjEmplTrans',
            to: 'HcmWorker',
            fields: ['ProjEmplTrans.Worker = HcmWorker.RecId'],
            badge: 'field match — not a declared FK',
            note: 'Hidden deprecated column (EDT ProjWorkerRecId); no AOT relation to HcmWorker in either direction, so this is a field-value match only. The live path from a timesheet line is ProjEmplTrans.Resource → ResResourceIdentifier, gated on RefTableId.'
          },
          {
            from: 'ProjEmplTrans',
            to: 'ResResourceIdentifier',
            badge: 'conditional FK — requires RefTableId = tableNum(HcmWorker)',
            note: 'ProjEmplTrans.Resource is a declared FK to ResResourceIdentifier.RecId, which is a generic (RefTableId, RefRecId) pointer; the worker is reached through the resource identifier only when RefTableId = tableNum(HcmWorker). There is no direct ProjEmplTrans → HcmWorker relation.',
            fields: ['ProjEmplTrans.Resource = ResResourceIdentifier.RecId']
          },
          {
            from: 'ProjEmplTrans',
            to: 'ProjTable',
            badge: 'declared FK',
            note: 'Posted employee transaction is associated with its project.',
            fields: ['ProjEmplTrans.ProjId = ProjTable.ProjId']
          }
        ]
      },
      {
        id: 'proj-invoice',
        title: 'Invoice (On-account/Progress)',
        description: 'Create and review invoice proposals; posting creates the customer invoice. Time-and-material billing selects eligible project transactions, while fixed-price billing uses on-account transactions or billing schedules. Revenue recognition is a separate process in the next stage.',
        roles: ['Project', 'AR'],
        menuPaths: ['Project management and accounting > Periodic > Project invoices'],
        docs: [
          {
            title: 'Manage project invoice proposals',
            url: 'https://learn.microsoft.com/en-us/dynamics365/project-operations/invoicing/format-update-project-invoice-proposals'
          }
        ],
        pitfalls: ['On-account setup missing', 'Retainage not configured'],
        prerequisites: ['On-account setup', 'Funding rules'],
        tables: ['ProjInvoiceTable', 'ProjInvoiceJour', 'ProjOnAccTrans'],
        relations: [
          {
            from: 'ProjInvoiceJour',
            to: 'ProjInvoiceTable',
            fields: ['ProjInvoiceJour.ProjInvoiceProjId = ProjInvoiceTable.ProjInvoiceProjId'],
            badge: 'declared FK',
            note: 'Posted project invoice journal references the project billing contract.',
          },
        ],
        approvals: ['Invoice approval workflow (optional)']
      },
      {
        id: 'proj-revrec',
        title: 'Revenue Recognition',
        description: "Use the project's cost-and-revenue profile and completion method to calculate and review revenue recognition, then post recognized revenue or deferrals. This is separate from invoice proposal posting.",
        roles: ['Controller'],
        menuPaths: ['Project management and accounting > Periodic > Revenue recognition'],
        docs: [
          {
            title: 'Recognize project revenue',
            url: 'https://learn.microsoft.com/en-us/dynamics365/guidance/business-processes/project-to-profit-recognize-project-revenue'
          }
        ],
        pitfalls: ['Schedule not set', 'Allocation method wrong', 'Cost-and-revenue profile or completion method missing'],
        prerequisites: ['Cost-and-revenue profile', 'Completion method', 'Revenue recognition schedule', 'Project group rules'],
        tables: ['ProjRevenueTrans', 'ProjCostTrans', 'SubledgerVoucherGeneralJournalEntry', 'ProjTable'],
        relations: [
          {
            from: 'ProjRevenueTrans',
            to: 'ProjTable',
            badge: 'declared FK',
            note: 'Revenue transaction is associated with its project.',
            fields: ['ProjRevenueTrans.ProjId = ProjTable.ProjId']
          },
          {
            from: 'ProjRevenueTrans',
            to: 'SubledgerVoucherGeneralJournalEntry',
            badge: 'field match — not a declared FK',
            note: 'Voucher-field match only; standard metadata has no AOT relation in either direction.',
            fields: ['ProjRevenueTrans.VoucherJournal = SubledgerVoucherGeneralJournalEntry.Voucher']
          }
        ]
      }
    ],
    edges: [
      { from: 'proj-quote', to: 'proj-contract' },
      { from: 'proj-contract', to: 'proj-exec' },
      { from: 'proj-exec', to: 'proj-invoice' },
      { from: 'proj-invoice', to: 'proj-revrec' }
    ]
  },
  {
    id: 'rtr',
    title: 'Record to Report',
    summary: 'Set up the ledger, post daily and period-end journals, complete applicable revaluation, allocation, bank reconciliation, consolidation and reporting work, then control period and year-end close separately.',
    module: 'Finance',
    stages: [
      {
        id: 'gl-setup',
        title: 'GL & Calendar Setup',
        description: "Set up the legal-entity ledger's chart of accounts, main accounts, account structures, currencies, fiscal calendar, and financial dimensions that govern posting.",
        roles: ['Controller'],
        menuPaths: ['General ledger > Ledger setup > Ledger'],
        docs: [
          {
            title: 'Plan your chart of accounts',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/plan-chart-of-accounts'
          }
        ],
        pitfalls: ['Ledger assigned to the wrong chart of accounts or fiscal calendar', 'Account structure or dimension setup does not permit the intended postings'],
        prerequisites: ['Legal entity ledger', 'Chart of accounts and main accounts', 'Account structures and financial dimensions', 'Fiscal calendar and currencies'],
        tables: ['Ledger', 'LedgerChartOfAccounts', 'MainAccount', 'FiscalCalendar', 'FiscalCalendarPeriod', 'Currency', 'DimensionHierarchy', 'DimensionAttributeValueCombination', 'CompanyInfo'],
        relations: [
          {
            from: 'MainAccount',
            to: 'LedgerChartOfAccounts',
            badge: 'declared FK',
            note: 'Main account belongs to its chart of accounts.',
            fields: ['MainAccount.LedgerChartOfAccounts = LedgerChartOfAccounts.RecId']
          },
          {
            from: 'Ledger',
            to: 'LedgerChartOfAccounts',
            badge: 'declared FK',
            note: 'The legal-entity ledger selects a chart of accounts.',
            fields: ['Ledger.ChartOfAccounts = LedgerChartOfAccounts.RecId']
          },
          {
            from: 'Ledger',
            to: 'FiscalCalendar',
            badge: 'declared FK',
            note: 'The ledger uses this fiscal calendar.',
            fields: ['Ledger.FiscalCalendar = FiscalCalendar.RecId']
          },
          {
            from: 'Ledger',
            to: 'CompanyInfo',
            badge: 'declared FK',
            note: 'The ledger is associated with its legal-entity company record.',
            fields: ['Ledger.PrimaryForLegalEntity = CompanyInfo.RecId']
          },
        ],
      },
      {
        id: 'journals',
        title: 'Daily Journals',
        description: 'Create, validate, and post routine general journals using ledger accounts and dimensions; distinguish journal lines from the posted general-journal entry and account entries.',
        roles: ['Controller'],
        menuPaths: ['General ledger > Journal entries > General journals'],
        docs: [
          {
            title: 'Ledger and subledger accounting overview',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/ledger-subledger'
          }
        ],
        pitfalls: ['Journal is unbalanced or has an invalid account/dimension combination', 'Posting date falls in a period that is not open', 'Required journal approval is incomplete'],
        prerequisites: ['Ledger and chart of accounts configured', 'Journal names', 'Posting period open for the posting date'],
        tables: ['LedgerJournalTable', 'LedgerJournalTrans', 'SubledgerVoucherGeneralJournalEntry', 'GeneralJournalEntry', 'GeneralJournalAccountEntry', 'DimensionAttributeValueCombination'],
        relations: [
          {
            from: 'LedgerJournalTrans',
            to: 'LedgerJournalTable',
            badge: 'declared FK',
            note: 'Journal lines belong to the journal header.',
            fields: ['LedgerJournalTrans.JournalNum = LedgerJournalTable.JournalNum']
          },
          {
            from: 'LedgerJournalTrans',
            to: 'SubledgerVoucherGeneralJournalEntry',
            badge: 'field match — not a declared FK',
            note: 'Voucher value match only; standard metadata has no declared relation for this pair.',
            fields: ['LedgerJournalTrans.Voucher = SubledgerVoucherGeneralJournalEntry.Voucher']
          },
          {
            from: 'SubledgerVoucherGeneralJournalEntry',
            to: 'GeneralJournalEntry',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation.',
            fields: ['SubledgerVoucherGeneralJournalEntry.GeneralJournalEntry = GeneralJournalEntry.RecId']
          },
          {
            from: 'GeneralJournalAccountEntry',
            to: 'GeneralJournalEntry',
            badge: 'declared FK',
            note: 'Posted account-entry lines belong to the general-journal entry header.',
            fields: ['GeneralJournalAccountEntry.GeneralJournalEntry = GeneralJournalEntry.RecId']
          },
          {
            from: 'GeneralJournalAccountEntry',
            to: 'DimensionAttributeValueCombination',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Association.',
            fields: ['GeneralJournalAccountEntry.LedgerDimension = DimensionAttributeValueCombination.RecId']
          },
        ],
        approvals: ['Journal approval workflow (only when configured)']
      },
      {
        id: 'bank-reconciliation',
        title: 'Bank Reconciliation',
        description: 'Reconcile legal-entity bank transactions to the bank statement, clear matched transactions, enter statement-only fees or interest, and post when the unreconciled balance is zero.',
        roles: ['Controller'],
        menuPaths: ['Cash and bank management > Bank statement reconciliation > Bank reconciliation'],
        docs: [
          {
            title: 'Reconcile a bank account',
            url: 'https://learn.microsoft.com/dynamics365/finance/cash-bank-management/reconcile-bank-account'
          }
        ],
        pitfalls: ['Pending-cancellation transactions block reconciliation', 'Unmatched transactions or statement-only entries leave a nonzero unreconciled balance', 'Reconciliation is cancelled or reversed out of chronological order'],
        prerequisites: ['Bank account and bank statement details available', 'Bank transactions posted', 'Statement date and ending balance confirmed'],
        tables: ['BankAccountTable', 'BankAccountTrans', 'LedgerJournalTable', 'LedgerJournalTrans'],
        optional: true
      },
      {
        id: 'period-adjustments',
        title: 'Period-end Adjustments & Settlement',
        description: 'Review period-end accruals and adjustments, post the required journals, and complete ledger-account settlement and journalizing where used.',
        roles: ['Controller'],
        menuPaths: ['General ledger > Journal entries > General journals'],
        docs: [
          {
            title: 'Close the general ledger at period end',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/close-general-ledger-at-period-end'
          }
        ],
        pitfalls: ['Adjusting entry posted to the wrong period', 'Required supporting schedules or balances are incomplete', 'Settlement or journalizing omitted where the organization uses it'],
        prerequisites: ['Period-end balances reviewed', 'Required adjustment journals prepared', 'Target posting period open'],
        tables: ['LedgerJournalTable', 'LedgerJournalTrans', 'GeneralJournalEntry', 'GeneralJournalAccountEntry']
      },
      {
        id: 'fx-revaluation',
        title: 'Foreign Currency Revaluation',
        description: "Revalue eligible foreign-currency general-ledger balances at period end, review the unrealized gain/loss preview, and post or reverse the result. Use AR, AP, or Bank revaluation for those modules' open items; exclude those control accounts from GL revaluation when the subledger revaluation posts them.",
        roles: ['Controller'],
        menuPaths: ['General ledger > Periodic tasks > Foreign currency revaluation'],
        docs: [
          {
            title: 'Foreign currency revaluation for General ledger',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/foreign-currency-revaluation-general-ledger'
          }
        ],
        pitfalls: ['Wrong rate date or exchange-rate type', 'The same AR, AP, or Bank control balance is revalued both in its subledger and in GL', 'Preview, legal-entity scope, or posting result not reviewed'],
        prerequisites: ['Foreign-currency rates and ledger revaluation accounts configured', 'Eligible main accounts marked for revaluation', 'Target posting period open'],
        tables: ['Ledger', 'MainAccount', 'Currency', 'ExchangeRate', 'GeneralJournalEntry', 'GeneralJournalAccountEntry'],
        optional: true
      },
      {
        id: 'allocations',
        title: 'Allocations',
        description: 'Run configured ledger allocation rules for the period, review the generated allocation journal, and post it before final reporting.',
        roles: ['Controller'],
        menuPaths: ['General ledger > Allocations > Process allocation request'],
        docs: [
          {
            title: 'Ledger allocation rules',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/ledger-allocation-rules'
          }
        ],
        pitfalls: ['Wrong allocation basis or date interval', 'Destination account or dimension is invalid', 'Generated allocation journal is not reviewed or posted'],
        prerequisites: ['Allocation rules and destination accounts/dimensions configured', 'Source balances available for allocation', 'Target posting period open'],
        tables: ['LedgerAllocationRule', 'LedgerJournalTable', 'LedgerJournalTrans', 'GeneralJournalEntry', 'GeneralJournalAccountEntry'],
        optional: true
      },
      {
        id: 'consol',
        title: 'Consolidation & Elimination',
        description: 'Consolidate selected legal entities using configured account mapping and currency translation; separately configure, run, and review elimination journals when required.',
        roles: ['Controller'],
        menuPaths: ['Consolidations > Consolidate online'],
        docs: [
          {
            title: 'Prepare a legal entity for the consolidation process',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/prepare-company-for-consolidation'
          }
        ],
        pitfalls: ['Source balances changed after consolidation and results were not rerun', 'Currency translation or account mapping is wrong', 'Intercompany elimination is assumed automatic or its journal is not reviewed and posted'],
        prerequisites: ['Source and consolidation legal entities configured', 'Fiscal periods and currency rates available', 'Main-account mapping configured where charts differ', 'Elimination company and rules configured when eliminations are required'],
        tables: ['LedgerConsolidateTemplate', 'LedgerConsolidateHist', 'MainAccount', 'ExchangeRate'],
        relations: [
          {
            from: 'LedgerConsolidateHist',
            to: 'LedgerConsolidateTemplate',
            badge: 'declared FK',
            fields: ['LedgerConsolidateHist.ConsolidateTemplate = LedgerConsolidateTemplate.RecId'],
            note: 'The consolidation history record identifies the template used. AOT declares an AxTableRelation with a Field constraint (`xml_type=\'\'`), not an AxTableRelationForeignKey element.',
          },
        ],
        optional: true
      },
      {
        id: 'financial-reporting',
        title: 'Financial Reporting',
        description: 'Generate and review period-end financial statements from posted ledger balances; use Financial reporting for multi-company reporting when appropriate, and distinguish it from the General ledger Consolidate online run.',
        roles: ['Controller'],
        menuPaths: ['General ledger > Inquiries and reports > Financial reports'],
        docs: [
          {
            title: 'Financial reporting overview',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/financial-reporting-getting-started'
          }
        ],
        pitfalls: ['Statements are generated from stale or unreviewed ledger balances', 'Financial reporting consolidation is treated as the same run as Consolidate online'],
        prerequisites: ['Required period-end postings and adjustments complete', 'Financial report definitions and company/period context confirmed'],
        tables: ['GeneralJournalEntry', 'GeneralJournalAccountEntry', 'DimensionAttributeValueCombination'],
        optional: true
      },
      {
        id: 'close',
        title: 'Period Close Controls',
        description: 'After close work is complete, review and set the status for each ledger and fiscal-calendar period; use the Financial period close workspace to assign and track tasks, not as the period-status control.',
        roles: ['Controller'],
        menuPaths: ['General ledger > Period close > Closing sheet; General ledger > Period close > Financial period close configuration (workspace)'],
        docs: [
          {
            title: 'Financial period close workspace',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/financial-period-close-workspace'
          }
        ],
        pitfalls: ['Putting a period on hold before required postings finish', 'Permanently closing a period while later adjustments may still be needed', 'Treating task completion in the workspace as equivalent to ledger-period status'],
        prerequisites: ['Required subledger and ledger postings reconciled', 'Period-end review completed', 'Ledger and fiscal-period scope confirmed'],
        tables: ['LedgerFiscalCalendarPeriod', 'FiscalCalendarPeriod', 'Ledger', 'GeneralJournalEntry'],
        relations: [
          {
            from: 'LedgerFiscalCalendarPeriod',
            to: 'FiscalCalendarPeriod',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation.',
            fields: ['LedgerFiscalCalendarPeriod.FiscalCalendarPeriod = FiscalCalendarPeriod.RecId']
          },
          {
            from: 'LedgerFiscalCalendarPeriod',
            to: 'Ledger',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation.',
            fields: ['LedgerFiscalCalendarPeriod.Ledger = Ledger.RecId']
          },
        ],
      },
      {
        id: 'year-end-close',
        title: 'Year-end Close',
        description: 'At fiscal year-end, run year-end close to transfer balance-sheet balances and profit-and-loss balances to retained earnings; closing transactions are optional, and the process can be rerun after adjusting entries.',
        roles: ['Controller'],
        menuPaths: ['Batch process — no menu item'],
        docs: [
          {
            title: 'Year-end close',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/year-end-close'
          }
        ],
        pitfalls: ['Template groups companies with different fiscal calendars', 'Retained-earnings account or dimension-transfer setup is wrong', 'Permanently closed status or rerun behavior is not reviewed before execution'],
        prerequisites: ['Year-end template contains only legal entities with the selected fiscal calendar', 'Retained-earnings main accounts and dimension-transfer rules reviewed', 'Adjusting-entry and rerun plan agreed'],
        tables: ['LedgerFiscalCalendarPeriod', 'FiscalCalendarPeriod', 'Ledger', 'GeneralJournalEntry'],
        optional: true
      }
    ],
    edges: [
      { from: 'gl-setup', to: 'journals' },
      { from: 'journals', to: 'period-adjustments' },
      { from: 'period-adjustments', to: 'close' },
      { from: 'journals', to: 'bank-reconciliation' },
      { from: 'bank-reconciliation', to: 'close' },
      { from: 'period-adjustments', to: 'fx-revaluation' },
      { from: 'fx-revaluation', to: 'allocations' },
      { from: 'allocations', to: 'consol' },
      { from: 'consol', to: 'financial-reporting' },
      { from: 'financial-reporting', to: 'close' },
      { from: 'close', to: 'year-end-close' },
    ]
  },
  {
    id: 'hr',
    title: 'Hire to Retire',
    summary: 'Set up workers and positions, run onboarding processes, administer compensation, benefits and leave/absence, and manage offboarding when employment ends.',
    module: 'HR',
    stages: [
      {
        id: 'positions',
        title: 'Workers & Positions',
        description: 'Maintain worker and employment records, establish position hierarchies, and assign workers to positions through the assignment record.',
        roles: ['HR'],
        menuPaths: ['Human resources > Workers > HcmWorkerListPage_Workers'],
        docs: [
          {
            title: 'Positions — Dynamics 365 Human Resources',
            url: 'https://learn.microsoft.com/dynamics365/human-resources/hr-personnel-positions'
          }
        ],
        pitfalls: [
          'Looking for a worker column on HcmPosition — it has none; the link is the HcmPositionWorkerAssignment record',
          'Employee/contractor distinction treated as a field on HcmEmployment instead of the HcmEmploymentEmployee and HcmEmploymentContractor subtypes'
        ],
        prerequisites: ['Worker/person setup', 'Employing legal entity', 'Position hierarchy setup'],
        tables: ['HcmWorker', 'HcmPosition', 'HcmEmployment', 'HcmPositionHierarchy', 'HcmPositionWorkerAssignment', 'HcmEmploymentEmployee', 'HcmEmploymentContractor'],
        relations: [
          {
            from: 'HcmEmployment',
            to: 'HcmWorker',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation.',
            fields: ['HcmEmployment.Worker = HcmWorker.RecId']
          },
          {
            from: 'HcmEmployment',
            to: 'CompanyInfo',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation. Endpoint table only — no chip.',
            fields: ['HcmEmployment.LegalEntity = CompanyInfo.RecId']
          },
          {
            from: 'HcmWorker',
            to: 'DirPerson',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation.',
            fields: ['HcmWorker.Person = DirPerson.RecId']
          },
          {
            from: 'HcmPositionWorkerAssignment',
            to: 'HcmPosition',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation. The position-worker bridge — HcmPosition itself has no declared relation to HcmWorker.',
            fields: ['HcmPositionWorkerAssignment.Position = HcmPosition.RecId']
          },
          {
            from: 'HcmPositionWorkerAssignment',
            to: 'HcmWorker',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation.',
            fields: ['HcmPositionWorkerAssignment.Worker = HcmWorker.RecId']
          },
          {
            from: 'HcmPositionHierarchy',
            to: 'HcmPosition',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation. Child position edge.',
            fields: ['HcmPositionHierarchy.Position = HcmPosition.RecId']
          },
          {
            from: 'HcmPositionHierarchy',
            to: 'HcmPosition',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Association. Parent position edge — distinct from the Position edge.',
            fields: ['HcmPositionHierarchy.ParentPosition = HcmPosition.RecId']
          },
          {
            from: 'HcmPositionHierarchy',
            to: 'HcmPositionHierarchyType',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation. Endpoint table only — no chip.',
            fields: ['HcmPositionHierarchy.PositionHierarchyType = HcmPositionHierarchyType.RecId']
          },
          {
            from: 'HcmEmploymentEmployee',
            to: 'HcmEmployment',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation. Employee subtype, not a WorkerType value.',
            fields: ['HcmEmploymentEmployee.Employment = HcmEmployment.RecId']
          },
          {
            from: 'HcmEmploymentContractor',
            to: 'HcmEmployment',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation. Contractor subtype, not a WorkerType value.',
            fields: ['HcmEmploymentContractor.Employment = HcmEmployment.RecId']
          }
        ]
      },
      {
        id: 'onboard',
        title: 'Onboarding Processes',
        description: 'Configure onboarding process templates and task configuration; execute onboarding as a process, not as a generic checklist table.',
        roles: ['HR'],
        menuPaths: [
          'Human resources > Onboarding > HcmOnboardProcessTemplateListPage (business-process template, not a worker form)',
          'Human resources > Onboarding > HcmOnboardTaskConfiguration'
        ],
        docs: [
          {
            title: 'Task management (onboarding, offboarding, transitions)',
            url: 'https://learn.microsoft.com/dynamics365/human-resources/hr-task-mgmt'
          }
        ],
        pitfalls: [
          'Expecting a generic checklist table or a worker security-role table — there is none; tasks are onboarding process tasks',
          'Treating access provisioning as an HR table relation instead of a separate IT action'
        ],
        prerequisites: ['Applicable onboarding process template configured'],
        tables: ['HcmOnboardProcessHeader', 'HcmOnboardProcessTask', 'HcmOnboardLibraryTask', 'HcmOnboardTemplateTask', 'HcmOnboardTemplateAgentTasks'],
        relations: [
          {
            from: 'HcmOnboardProcessHeader',
            to: 'BusinessProcessHeader',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Composition. Endpoint table only — no chip.',
            fields: ['HcmOnboardProcessHeader.ProcessHeader = BusinessProcessHeader.RecId']
          },
          {
            from: 'HcmOnboardProcessHeader',
            to: 'HcmEmployment',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Association.',
            fields: ['HcmOnboardProcessHeader.Employment = HcmEmployment.RecId']
          },
          {
            from: 'HcmOnboardProcessHeader',
            to: 'HcmWorker',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Association.',
            fields: ['HcmOnboardProcessHeader.OnboardedEmployee = HcmWorker.RecId']
          },
          {
            from: 'HcmOnboardProcessTask',
            to: 'HcmPosition',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Association.',
            fields: ['HcmOnboardProcessTask.AssignedPosition = HcmPosition.RecId']
          },
          {
            from: 'HcmOnboardProcessTask',
            to: 'BusinessProcessTask',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Composition. Endpoint table only — no chip.',
            fields: ['HcmOnboardProcessTask.Task = BusinessProcessTask.RecId']
          },
          {
            from: 'HcmOnboardLibraryTask',
            to: 'HcmPosition',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Association.',
            fields: ['HcmOnboardLibraryTask.AssignedPosition = HcmPosition.RecId']
          },
          {
            from: 'HcmOnboardLibraryTask',
            to: 'BusinessProcessLibraryTask',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Composition. Endpoint table only — no chip.',
            fields: ['HcmOnboardLibraryTask.LibraryTask = BusinessProcessLibraryTask.RecId']
          },
          {
            from: 'HcmOnboardTemplateTask',
            to: 'HcmPosition',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Association.',
            fields: ['HcmOnboardTemplateTask.AssignedPosition = HcmPosition.RecId']
          },
          {
            from: 'HcmOnboardTemplateTask',
            to: 'BusinessProcessTemplateTask',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Composition. Endpoint table only — no chip.',
            fields: ['HcmOnboardTemplateTask.TemplateTask = BusinessProcessTemplateTask.RecId']
          },
          {
            from: 'HcmOnboardTemplateAgentTasks',
            to: 'BusinessProcessTemplateHeader',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Composition. Endpoint table only — no chip.',
            fields: ['HcmOnboardTemplateAgentTasks.TemplateHeader = BusinessProcessTemplateHeader.RecId']
          }
        ],
        optional: true
      },
      {
        id: 'compensation',
        title: 'Compensation',
        description: 'Administer fixed and variable compensation plans, eligibility, and compensation events/processes; this is separate from benefit enrollment.',
        roles: ['HR'],
        menuPaths: [
          'Human resources > Compensation > Fixed compensation > HcmCompensationLevel',
          'Human resources > Compensation > Variable compensation > HRMCompVarPlanTable',
          'Human resources > Compensation > Eligibility (compensation) > HRMCompEligibility',
          'Human resources > Compensation > Process (compensation) > HRMCompEvent'
        ],
        docs: [
          {
            title: 'Compensation plans overview',
            url: 'https://learn.microsoft.com/dynamics365/human-resources/hr-compensation-overview'
          }
        ],
        pitfalls: [
          'Using a compensation *Staging table as a business record — the business tables are the HRMComp* ones',
          'Merging plan administration with benefit enrollment; they are separate processes with separate eligibility'
        ],
        prerequisites: ['Relevant compensation plan and eligibility/event configuration'],
        tables: ['HRMCompFixedPlanTable', 'HRMCompVarPlanTable', 'HRMCompEligibility', 'HRMCompEvent', 'HRMCompProcess', 'HcmCompensationLevel'],
        relations: [
          {
            from: 'HRMCompEvent',
            to: 'HRMCompProcess',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation.',
            fields: ['HRMCompEvent.ProcessId = HRMCompProcess.ProcessId']
          }
        ],
        optional: true
      },
      {
        id: 'benefits',
        title: 'Benefits',
        description: 'Configure benefit plans, types, options and eligibility, and manage worker benefit records.',
        roles: ['HR'],
        menuPaths: ['Unverified — benefits menu path not resolved'],
        docs: [
          {
            title: 'Configure benefit plans',
            url: 'https://learn.microsoft.com/dynamics365/human-resources/hr-benefits-plans-setup'
          }
        ],
        pitfalls: [
          'Benefits navigation is unverified — do not follow an assumed menu path',
          'Treating benefit eligibility as the same mechanism as compensation eligibility'
        ],
        prerequisites: ['Benefit plan/type/option and eligibility setup'],
        tables: ['HcmBenefit', 'HcmBenefitPlan', 'HcmBenefitType', 'HcmBenefitOption', 'HcmBenefitEligibilityRule', 'HcmBenefitEligibility'],
        relations: [
          {
            from: 'HcmBenefit',
            to: 'HcmBenefitOption',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation.',
            fields: ['HcmBenefit.BenefitOption = HcmBenefitOption.RecId']
          },
          {
            from: 'HcmBenefit',
            to: 'HcmBenefitPlan',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation.',
            fields: ['HcmBenefit.BenefitPlan = HcmBenefitPlan.RecId']
          },
          {
            from: 'HcmBenefitEligibilityRule',
            to: 'ExpressionTable',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Association. Endpoint table only — no chip.',
            fields: ['HcmBenefitEligibilityRule.ExpressionTable = ExpressionTable.RecId']
          },
          {
            from: 'HcmBenefitEligibilityRule',
            to: 'SysPolicyRule',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Specialization. Endpoint table only — no chip.',
            fields: ['HcmBenefitEligibilityRule.RecId = SysPolicyRule.RecId']
          }
        ],
        optional: true
      },
      {
        id: 'leave',
        title: 'Leave & Absence',
        description: 'Manage leave types and the confirmed employment leave/vacation records as an ongoing employment process.',
        roles: ['HR'],
        menuPaths: [
          'Human resources > Workers > Leave > HcmEmploymentLeaveListPage',
          'Human resources > Workers > Leave > HcmLeaveType',
          'Human resources > Absence > HRMAbsenceCode'
        ],
        docs: [
          {
            title: 'Configure leave and absence types',
            url: 'https://learn.microsoft.com/dynamics365/human-resources/hr-leave-and-absence-types'
          }
        ],
        pitfalls: [
          'Describing leave requests, balances or accrual schedules as confirmed tables — that persistence is unprobed',
          'Assuming an approval workflow table chain that this flow does not document'
        ],
        prerequisites: ['Leave type and employment leave/vacation setup'],
        tables: ['HcmLeaveType', 'HcmEmploymentLeave', 'HcmEmploymentVacation'],
        relations: [
          {
            from: 'HcmEmploymentLeave',
            to: 'HcmEmployment',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation.',
            fields: ['HcmEmploymentLeave.Employment = HcmEmployment.RecId']
          },
          {
            from: 'HcmEmploymentLeave',
            to: 'HcmLeaveType',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation.',
            fields: ['HcmEmploymentLeave.LeaveType = HcmLeaveType.RecId']
          },
          {
            from: 'HcmEmploymentVacation',
            to: 'HcmEmployment',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation.',
            fields: ['HcmEmploymentVacation.Employment = HcmEmployment.RecId']
          }
        ],
        optional: true
      },
      {
        id: 'offboard',
        title: 'Offboarding',
        description: 'When employment ends, record the employment term and use the offboarding business-process template; this is a conditional terminal branch.',
        roles: ['HR', 'IT'],
        menuPaths: [
          'Human resources > Offboarding > HcmOffboardProcessTemplateListPage (business-process template; there is no Terminate menu item)',
          'Human resources > Offboarding > HcmOffboardTaskConfiguration',
          'Human resources > Transitions > HcmTransitionProcessTemplateListPage'
        ],
        docs: [
          {
            title: 'Overview of the Terminate workers business process',
            url: 'https://learn.microsoft.com/dynamics365/guidance/business-processes/hire-to-retire-onboard-terminate-employment'
          }
        ],
        pitfalls: [
          'Looking for a Terminate menu item — no such menu item was found; offboarding runs through the business-process template',
          'Expecting HcmEmploymentTerm to establish final pay — it does not',
          'Treating security removal as a worker/security table relation; it is a separate IT action'
        ],
        prerequisites: ['Termination decision/effective date', 'Applicable offboarding process template configured'],
        tables: ['HcmEmployment', 'HcmEmploymentTerm'],
        relations: [
          {
            from: 'HcmEmploymentTerm',
            to: 'HcmEmployment',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation.',
            fields: ['HcmEmploymentTerm.Employment = HcmEmployment.RecId']
          },
          {
            from: 'HcmEmploymentTerm',
            to: 'HcmAgreementTerm',
            badge: 'declared FK',
            note: 'Declared relation; relationship_type is Aggregation. Endpoint table only — no chip.',
            fields: ['HcmEmploymentTerm.AgreementTerm = HcmAgreementTerm.RecId']
          }
        ],
        optional: true
      }
    ],
    edges: [
      { from: 'positions', to: 'onboard' },
      { from: 'positions', to: 'compensation' },
      { from: 'positions', to: 'benefits' },
      { from: 'positions', to: 'leave' },
      { from: 'positions', to: 'offboard' }
    ]
  },
  {
    id: 'service',
    title: 'Service Lifecycle',
    summary: 'Service objects and agreements support standalone-capable service orders; dispatch recurs, while service-order invoices and subscription fees remain separate outcomes.',
    module: 'Service',
    stages: [
      {
        id: 'installed-base',
        title: 'Service Objects (Installed Base)',
        description: 'Maintain the customer assets or products that can receive service, and their service-object relations; this setup exists independently of a service order.',
        roles: ['Service'],
        menuPaths: ['Service management > Setup > Service objects > Service objects (Unverified)'],
        docs: [
          {
            title: 'Service objects overview',
            url: 'https://learn.microsoft.com/en-us/dynamics365/supply-chain/service-management/service-objects'
          }
        ],
        pitfalls: ['Do not equate every service object with an inventory item or make setup mandatory for non-asset service orders.'],
        prerequisites: ['For inventory-linked tangible objects, the released item and relevant inventory dimensions; not required for intangible or non-inventory objects.'],
        tables: ['SMAServiceObjectTable', 'SMAServiceObjectRelation'],
        relations: [],
        optional: true
      },
      {
        id: 'agreement',
        title: 'Service Agreements',
        description: 'Define project-backed service coverage, agreement group, validity, and work lines; an agreement can generate service orders but is not required for every order.',
        roles: ['Service'],
        menuPaths: ['Service management > Service agreements'],
        docs: [
          {
            title: 'Develop and establish service agreements overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/service-management/service-agreements'
          }
        ],
        pitfalls: ['Service agreement group is missing', 'Agreement or line is suspended/stopped', 'Validity period does not cover the generated order'],
        prerequisites: ['Project', 'Service agreement group', 'Service-object/item setup when coverage is object-specific'],
        tables: ['SMAAgreementTable', 'SMAAgreementLine'],
        relations: [
          {
            from: 'SMAAgreementLine',
            to: 'SMAAgreementTable',
            fields: ['SMAAgreementLine.AgreementId = SMAAgreementTable.AgreementId'],
            badge: 'declared FK',
            note: 'Composition — agreement line belongs to the agreement header.'
          },
          {
            from: 'SMAAgreementLine',
            to: 'SMAServiceObjectRelation',
            fields: ['SMAAgreementLine.ServiceObjectRelationId = SMAServiceObjectRelation.ServiceObjectRelationId'],
            badge: 'declared FK',
            note: 'Association — identifies the covered service-object relation.'
          },
          {
            from: 'SMAAgreementLine',
            to: 'SMAServiceObjectTable',
            fields: ['SMAAgreementLine.ServiceObjectId = SMAServiceObjectTable.ServiceObjectId'],
            badge: 'declared FK',
            note: 'Association — identifies the service object covered by the line.'
          },
          {
            from: 'SMAAgreementLine',
            to: 'SMAServiceTask',
            fields: ['SMAAgreementLine.ServiceTaskId = SMAServiceTask.ServiceTaskId'],
            badge: 'declared FK',
            note: 'Association — classifies the agreement work. Endpoint only; no chip, no tableDef.'
          },
          {
            from: 'SMAAgreementLine',
            to: 'ProjTable',
            fields: ['SMAAgreementLine.ProjId = ProjTable.ProjId'],
            badge: 'declared FK',
            note: 'Association — project used for agreement-line posting.'
          },
          {
            from: 'SMAAgreementLine',
            to: 'InventTable',
            fields: ['SMAAgreementLine.ItemId = InventTable.ItemId'],
            badge: 'declared FK',
            note: 'Association — item for item-type agreement work.'
          },
          {
            from: 'SMAAgreementTable',
            to: 'SMAServiceObjectRelation',
            fields: ['SMAAgreementTable.AgreementId = SMAServiceObjectRelation.RelKeyId'],
            badge: 'conditional FK — requires SMAServiceObjectRelation.RelTableId = tableNum(SMAAgreementTable)',
            note: 'Association — polymorphic service-object relation. RelTableId (system field) discriminates the owning table, so the agreement link applies only when RelTableId is SMAAgreementTable; the key is stored in RelKeyId.'
          }
        ],
        optional: true
      },
      {
        id: 'service-order',
        title: 'Service Orders',
        description: 'Create a customer-site service visit with one or more hour, item, expense, or fee lines. Orders can originate from an agreement or be created individually; this is the operational hub.',
        roles: ['Service'],
        menuPaths: ['Service management > Service orders'],
        docs: [
          {
            title: 'Service orders',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/service-management/service-orders'
          }
        ],
        pitfalls: ['Do not require an agreement for a one-time order', 'Item requirements require a project', 'Do not treat service-order invoice lines as a direct CustInvoiceTrans join'],
        prerequisites: ['Customer and project context', 'An agreement and applicable agreement period only when agreement-linked', 'Service-object setup only when servicing an identified object'],
        tables: ['SMAServiceOrderTable', 'SMAServiceOrderLine', 'CustTable'],
        relations: [
          {
            from: 'SMAServiceOrderTable',
            to: 'SMAAgreementTable',
            fields: ['SMAServiceOrderTable.AgreementId = SMAAgreementTable.AgreementId'],
            badge: 'declared FK',
            note: 'Association — originating agreement when present. Standalone orders leave this empty.'
          },
          {
            from: 'SMAServiceOrderTable',
            to: 'CustTable',
            fields: ['SMAServiceOrderTable.CustAccount = CustTable.AccountNum'],
            badge: 'declared FK',
            note: 'Association — customer receiving service.'
          },
          {
            from: 'SMAServiceOrderTable',
            to: 'ProjTable',
            fields: ['SMAServiceOrderTable.ProjId = ProjTable.ProjId'],
            badge: 'declared FK',
            note: 'Association — project context for service-order posting.'
          },
          {
            from: 'SMAServiceOrderTable',
            to: 'SMAStageTable',
            fields: ['SMAServiceOrderTable.StageId = SMAStageTable.StageId'],
            badge: 'declared FK',
            note: 'Association — current order stage.'
          },
          {
            from: 'SMAServiceOrderLine',
            to: 'SMAServiceOrderTable',
            fields: ['SMAServiceOrderLine.ServiceOrderId = SMAServiceOrderTable.ServiceOrderId'],
            badge: 'declared FK',
            note: 'Composition — each line belongs to its service-order header.'
          },
          {
            from: 'SMAAgreementLine',
            to: 'SMAServiceOrderLine',
            fields: ['SMAAgreementLine.AgreementId = SMAServiceOrderLine.AgreementId', 'SMAAgreementLine.AgreementLineNum = SMAServiceOrderLine.AgreementLineNum'],
            badge: 'conditional FK — requires agreement linkage (AgreementId + AgreementLineNum populated)',
            note: 'Association — declared on SMAAgreementLine pointing to SMAServiceOrderLine. Applies only to agreement-based orders; standalone service orders carry no agreement line.'
          }
        ]
      },
      {
        id: 'dispatch',
        title: 'Dispatch and Monitor',
        description: 'Use the dispatch board to review service-activity status, assigned workers, service times, and activities not yet dispatched; this is recurring monitoring/scheduling, not a one-time transaction gate.',
        roles: ['Service'],
        menuPaths: ['Service management > Periodic tasks > Dispatch board'],
        docs: [
          {
            title: 'Dispatch board',
            url: 'https://learn.microsoft.com/en-us/dynamics365/supply-chain/service-management/dispatch-board'
          }
        ],
        pitfalls: ['Do not make dispatch a mandatory predecessor to every billing action; the board is revisited as activities change.', 'Microsoft Learn spells this menu "Perform periodic tasks"; this index uses "Periodic tasks" — same board, different wording.'],
        prerequisites: ['Service activities exist', 'Dispatch-team worker assignments and technician availability are maintained'],
        tables: ['SMAServiceOrderTable', 'SMADispatchTeamTable', 'SMADispatchWorkerSetup', 'WrkCtrTable', 'ResResourceIdentifier'],
        relations: [
          {
            from: 'SMADispatchWorkerSetup',
            to: 'SMADispatchTeamTable',
            fields: ['SMADispatchWorkerSetup.DispatchTeamId = SMADispatchTeamTable.DispatchTeamId'],
            badge: 'declared FK',
            note: 'Association — worker/team assignment. DispatchTeamDataAreaId carries company context.'
          }
        ],
        optional: true
      },
      {
        id: 'service-bill',
        title: 'Invoice Service Orders',
        description: 'Complete and post service-order transactions through the associated project/service invoicing process. Keep this outcome separate from recurring subscription-fee billing.',
        roles: ['Service', 'AR'],
        menuPaths: ['Service management > Service orders > Service invoices'],
        docs: [
          {
            title: 'Service orders',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/service-management/service-orders'
          }
        ],
        pitfalls: ['Do not add a direct SMAServiceOrderLine > CustInvoiceTrans row without a probe', 'Do not include subscription fees here'],
        prerequisites: ['Completed service-order lines and project context', 'Required posting setup'],
        tables: ['SMAServiceOrderTable', 'SMAServiceOrderLine', 'CustInvoiceTrans'],
        relations: [],
        approvals: ['Invoice approval workflow (optional)'],
        optional: true
      },
      {
        id: 'subscription-billing',
        title: 'Service Subscription Fees',
        description: 'Maintain subscriptions and their recurring fee periods as a separate project-based invoicing stream; the fee transactions are invoiced to the customer.',
        roles: ['Service', 'AR'],
        menuPaths: ['Service management > Service subscriptions'],
        docs: [
          {
            title: 'Service subscriptions',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/service-management/service-subscriptions'
          }
        ],
        pitfalls: ['The subscription group period code determines fee intervals; do not conflate subscription fees with service-order lines or invent an unverified fee-transaction table.'],
        prerequisites: ['Time-and-materials project and service subscription group/period code'],
        tables: ['SMASubscriptionTable'],
        relations: [],
        optional: true
      }
    ],
    edges: [
      { from: 'agreement', to: 'service-order' },
      { from: 'service-order', to: 'dispatch' },
      { from: 'service-order', to: 'service-bill' }
    ]
  }
]

export const tableDefs: Record<string, TableDef> = {
  CustTable: {
    name: "CustTable",
    description: "Customer master record holding all account-level attributes for AR, pricing, delivery, and credit management.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/common/customer/main/custtable",
    fields: [
      {
        name: "AccountNum",
        type: "String",
        note: "Primary key \u2014 unique customer account identifier used as FK across the entire OTC chain.",
      },
      {
        name: "CustGroup",
        type: "String",
        fkTarget: "CustGroup",
        note: "Customer group that drives posting profiles, payment terms defaults, and trade-agreement group lookups.",
      },
      {
        name: "Currency",
        type: "String",
        fkTarget: "Currency",
        note: "Default transaction currency for invoices and payments issued to this customer.",
      },
      {
        name: "PaymTermId",
        type: "String",
        fkTarget: "PaymTerm",
        note: "Default payment terms (e.g. Net30) inherited by quotations and sales orders.",
      },
      {
        name: "DlvMode",
        type: "String",
        fkTarget: "DlvMode",
        note: "Default mode of delivery (e.g. truck, air) carried onto sales orders.",
      },
      {
        name: "TaxGroup",
        type: "String",
        fkTarget: "TaxGroupHeading",
        note: "Sales tax group assigned to customer, combined with item tax group to determine applicable taxes.",
      },
      {
        name: "CreditMax",
        type: "Decimal",
        note: "Credit limit in the account currency; 0 means no limit enforced.",
      },
    ],
  },

  DirPartyTable: {
    name: "DirPartyTable",
    description: "Global Address Book party master — stores parties (customers, vendors, workers, organizations) used across modules.",
    module: "Global Address Book",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/common/gab/main/dirpartytable",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "PartyNumber",
        type: "String",
        note: "Unique party identifier",
      },
      {
        name: "Name",
        type: "String",
        note: "Primary display name for the party",
      },
      {
        name: "PrimaryAddressLocation",
        type: "Int64",
        fkTarget: "LogisticsLocation.RecId",
        note: "FK to primary address location (LogisticsLocation)",
      },
      {
        name: "PrimaryContactEmail",
        type: "String",
        note: "Primary email address (denormalised)",
      },
      {
        name: "PrimaryContactPhone",
        type: "String",
        note: "Primary phone number (denormalised)",
      },
      {
        name: "InstanceRelationType",
        type: "Int64",
        note: "Internal party type indicator (organization, person, etc.)",
      },
      {
        name: "DataAreaId",
        type: "String",
        note: "Legal entity / partition identifier",
      },
    ],
  },

  LogisticsPostalAddress: {
    name: "LogisticsPostalAddress",
    description: "Postal address records linked into the location framework and party locations; supports international address parts and validity dates.",
    module: "Global Address Book",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/common/gab/main/logisticspostaladdress",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "Address",
        type: "String",
        note: "Full street address / free-text address",
      },
      {
        name: "City",
        type: "String",
        note: "City / locality",
      },
      {
        name: "CountryRegionId",
        type: "String",
        note: "ISO country/region code",
      },
      {
        name: "ZipCode",
        type: "String",
        note: "Postal / ZIP code",
      },
      {
        name: "Location",
        type: "Int64",
        fkTarget: "LogisticsLocation.RecId",
        note: "FK to LogisticsLocation record (location framework)",
      },
      {
        name: "ValidFrom",
        type: "Date",
        note: "Address valid-from date",
      },
      {
        name: "ValidTo",
        type: "Date",
        note: "Address valid-to date (nullable)",
      },
    ],
  },

  LogisticsElectronicAddress: {
    name: "LogisticsElectronicAddress",
    description: "Electronic contact methods (email, phone, IM, URL) attached to parties/locations; supports role flags and privacy indicators.",
    module: "Global Address Book",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/common/gab/main/logisticselectronicaddress",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "Type",
        type: "Int32",
        note: "Enum: Email, Phone, URL, Fax, etc.",
      },
      {
        name: "Locator",
        type: "String",
        note: "The actual address/number (email addr, phone number, URL)",
      },
      {
        name: "IsPrimary",
        type: "Int32",
        note: "Primary contact flag",
      },
      {
        name: "IsPrivate",
        type: "Int32",
        note: "Privacy flag limiting visibility to the owning party",
      },
      {
        name: "Location",
        type: "Int64",
        fkTarget: "LogisticsLocation.RecId",
        note: "FK to LogisticsLocation if associated with a location",
      },
      {
        name: "ElectronicAddressRoles",
        type: "String",
        note: "Comma-separated roles (Billing, Shipping, Notification)",
      },
    ],
  },
  PriceDiscTable: {
    name: "PriceDiscTable",
    description: "Posted (active) trade agreement lines storing approved prices and discounts for customer\u2013item combinations.",
    module: "Sales and Marketing",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/salesandmarketing/group/pricedisctable",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "System-generated primary key.",
      },
      {
        name: "relation",
        type: "Enum",
        note: "Party/product scope of the trade agreement line (price, discount, line discount, multiline discount).",
      },
      {
        name: "AccountCode",
        type: "Enum",
        note: "Scope of the customer side: Table (specific account), Group (price group), or All customers.",
      },
      {
        name: "AccountRelation",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "FK to CustTable.AccountNum when AccountCode=Table; to CustPriceGroup when AccountCode=Group.",
      },
      {
        name: "ItemCode",
        type: "Enum",
        note: "Scope of the item side: Table (specific item), Group (item price group), or All items.",
      },
      {
        name: "ItemRelation",
        type: "String",
        fkTarget: "InventTable.ItemId",
        note: "FK to InventTable.ItemId when ItemCode=Table.",
      },
      {
        name: "Amount",
        type: "Decimal",
        note: "Agreed price (when Relation=PriceSales) or flat discount amount.",
      },
      {
        name: "FromDate",
        type: "Date",
        note: "Validity start date; engine only applies lines where today is within [FromDate, ToDate].",
      },
    ],
  },
  PriceDiscAdmTrans: {
    name: "PriceDiscAdmTrans",
    description: "Draft trade-agreement journal lines staged in a worksheet before posting to PriceDiscTable.",
    module: "Sales and Marketing",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/salesandmarketing/worksheetline/pricediscadmtrans",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "System-generated primary key.",
      },
      {
        name: "JournalNum",
        type: "String",
        fkTarget: "PriceDiscAdmTable.JournalNum",
        note: "Links back to the parent trade-agreement journal header.",
      },
      {
        name: "relation",
        type: "Enum",
        note: "Party/product scope of the trade agreement line (price, discount, line discount, multiline discount).",
      },
      {
        name: "AccountCode",
        type: "Enum",
        note: "Customer scope: Table / Group / All.",
      },
      {
        name: "AccountRelation",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Specific customer account when AccountCode=Table.",
      },
      {
        name: "ItemRelation",
        type: "String",
        fkTarget: "InventTable.ItemId",
        note: "Specific item when ItemCode=Table.",
      },
      {
        name: "Amount",
        type: "Decimal",
        note: "Proposed price or discount amount.",
      },
      {
        name: "Percent1",
        type: "Decimal",
        note: "Primary discount percentage (used for line/multiline/end discounts).",
      },
    ],
  },
  SalesQuotationTable: {
    name: "SalesQuotationTable",
    description: "Sales quotation header tracking customer proposals through Created \u2192 Sent \u2192 Confirmed/Lost states before converting to a sales order.",
    module: "Sales and Marketing",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/salesandmarketing/worksheetheader/salesquotationtable",
    fields: [
      {
        name: "QuotationId",
        type: "String",
        note: "Primary key \u2014 quotation number assigned from number sequence.",
      },
      {
        name: "CustAccount",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Customer account this quotation is addressed to.",
      },
      {
        name: "QuotationStatus",
        type: "Enum",
        note: "Lifecycle status: Created / Sent / Confirmed / Lost / Cancelled.",
      },
      {
        name: "QuotationExpiryDate",
        type: "Date",
        note: "Date after which the quotation is no longer valid.",
      },
      {
        name: "SalesIdRef",
        type: "String",
        fkTarget: "SalesTable.SalesId",
        note: "Sales order created from the confirmed quotation (filled on conversion).",
      },
      {
        name: "CurrencyCode",
        type: "String",
        fkTarget: "Currency",
        note: "Transaction currency for all amounts on this quotation.",
      },
      {
        name: "ProjIdRef",
        type: "String",
        note: "EDT ProjId; project reference on a project quotation.",
      },
      {
        name: "ProjInvoiceProjId",
        type: "String",
        note: "EDT ProjInvoiceProjId; project billing-contract reference.",
      },
    ],
  },
  SalesQuotationLine: {
    name: "SalesQuotationLine",
    description: "Individual product or service lines within a sales quotation, each carrying quantity, pricing, and inventory dimension data.",
    module: "Sales and Marketing",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/salesandmarketing/worksheetline/salesquotationline",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "System primary key.",
      },
      {
        name: "QuotationId",
        type: "String",
        fkTarget: "SalesQuotationTable.QuotationId",
        note: "Parent quotation header reference \u2014 composite logical PK with LineNum.",
      },
      {
        name: "LineNum",
        type: "Decimal",
        note: "Line sequence number within the quotation.",
      },
      {
        name: "ItemId",
        type: "String",
        fkTarget: "InventTable.ItemId",
        note: "Product being quoted.",
      },
      {
        name: "InventDimId",
        type: "String",
        fkTarget: "InventDim.inventDimId",
        note: "Inventory dimension combination (site, warehouse, color, size, etc.).",
      },
      {
        name: "SalesQty",
        type: "Decimal",
        note: "Quoted quantity in the sales unit of measure.",
      },
      {
        name: "SalesPrice",
        type: "Decimal",
        note: "Unit price proposed; may be derived from PriceDiscTable trade agreement.",
      },
      {
        name: "LineAmount",
        type: "Decimal",
        note: "Extended line value (SalesQty \u00d7 SalesPrice minus any line discounts).",
      },
    ],
  },
  SalesTable: {
    name: "SalesTable",
    description: "Sales order header governing the full lifecycle of a customer order from creation through invoicing.",
    module: "Sales and Marketing",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/salesandmarketing/worksheetheader/salestable",
    fields: [
      {
        name: "SalesId",
        type: "String",
        note: "Primary key \u2014 sales order number from number sequence.",
      },
      {
        name: "CustAccount",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Ordering/ship-to customer account.",
      },
      {
        name: "InvoiceAccount",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Invoice-to customer account \u2014 may differ from CustAccount in third-party billing scenarios.",
      },
      {
        name: "SalesStatus",
        type: "Enum",
        note: "Overall order status: Open order / Delivered / Invoiced / Cancelled.",
      },
      {
        name: "DocumentStatus",
        type: "Enum",
        note: "Furthest document produced: None / Confirmation / PickingList / PackingSlip / Invoice.",
      },
      {
        name: "QuotationId",
        type: "String",
        fkTarget: "SalesQuotationTable.QuotationId",
        note: "Source quotation if the order was converted from a quote.",
      },
      {
        name: "CurrencyCode",
        type: "String",
        fkTarget: "Currency",
        note: "Transaction currency inherited from the customer or overridden at entry.",
      },
      {
        name: "DeliveryDate",
        type: "Date",
        note: "Requested delivery date; drives ATP/CTP promise date calculations.",
      },
    ],
  },

  SalesAgreementTable: {
    name: "SalesAgreementTable",
    description: "Sales agreement (blanket order) header. In D365FO sales agreements are stored in the shared agreement framework: AgreementHeader with the SalesAgreement classification. Sales orders released against the agreement inherit negotiated prices and track fulfilment against committed totals.",
    module: "Sales and Marketing",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/supply-chain/sales-marketing/sales-agreements",
    fields: [
      {
        name: "AgreementClassification",
        type: "Int64",
        fkTarget: "AgreementClassification.RecId",
        note: "Agreement classification (SalesAgreement) that identifies this as a sales agreement.",
      },
      {
        name: "Currency",
        type: "String",
        fkTarget: "Currency.CurrencyCode",
        note: "Currency of the agreement.",
      },
      {
        name: "DefaultDimension",
        type: "Int64",
        fkTarget: "DimensionAttributeValueSet.RecId",
        note: "Default financial dimensions for the agreement.",
      },
      {
        name: "DocumentTitle",
        type: "String",
        note: "Agreement title.",
      },
      {
        name: "EarliestLineEffectiveDate",
        type: "Date",
        note: "Earliest effective date across all agreement lines.",
      },
      {
        name: "LatestLineExpirationDate",
        type: "Date",
        note: "Latest expiration date across all agreement lines.",
      },
      {
        name: "AgreementState",
        type: "Enum",
        note: "State of the agreement (validated, on hold, closed, etc.).",
      },
    ],
  },

  SalesAgreementLine: {
    name: "SalesAgreementLine",
    description: "Sales agreement commitment line. In D365FO stored in the shared AgreementLine table under a SalesAgreement-classified AgreementHeader; each line specifies a quantity or value commitment for an item. Released sales order lines consume the committed quantity/amount.",
    module: "Sales and Marketing",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/supply-chain/sales-marketing/sales-agreements",
    fields: [
      {
        name: "Agreement",
        type: "Int64",
        fkTarget: "AgreementHeader.RecId",
        note: "FK to the parent agreement header.",
      },
      {
        name: "AgreementLineType",
        type: "Enum",
        note: "Line type: item or category commitment.",
      },
      {
        name: "ItemId",
        type: "String",
        fkTarget: "InventTable.ItemId",
        note: "Item the commitment applies to.",
      },
      {
        name: "Category",
        type: "Int64",
        fkTarget: "EcoResCategory.RecId",
        note: "Procurement/sales category the commitment applies to.",
      },
      {
        name: "LineNumber",
        type: "Decimal",
        note: "Line number within the agreement.",
      },
      {
        name: "EffectiveDate",
        type: "Date",
        note: "Start of the commitment period.",
      },
      {
        name: "ExpirationDate",
        type: "Date",
        note: "End of the commitment period.",
      },
      {
        name: "IsMaxEnforced",
        type: "Enum",
        note: "Whether the commitment quantity/amount is a maximum that cannot be exceeded.",
      },
    ],
  },
  SalesLine: {
    name: "SalesLine",
    description: "Individual product or service lines on a sales order, tracking quantities through confirmation, picking, delivery, and invoicing.",
    module: "Sales and Marketing",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/salesandmarketing/worksheetline/salesline",
    fields: [
      {
        name: "SalesId",
        type: "String",
        fkTarget: "SalesTable.SalesId",
        note: "Parent sales order \u2014 part of the composite logical primary key.",
      },
      {
        name: "LineNum",
        type: "Decimal",
        note: "Line sequence; together with SalesId forms the natural compound key.",
      },
      {
        name: "ItemId",
        type: "String",
        fkTarget: "InventTable.ItemId",
        note: "Ordered product.",
      },
      {
        name: "InventDimId",
        type: "String",
        fkTarget: "InventDim.inventDimId",
        note: "Inventory dimension combination specifying site, warehouse, batch, serial, etc.",
      },
      {
        name: "SalesQty",
        type: "Decimal",
        note: "Originally ordered quantity.",
      },
      {
        name: "RemainSalesPhysical",
        type: "Decimal",
        note: "Quantity not yet physically delivered; decremented as packing slips are posted.",
      },
      {
        name: "SalesPrice",
        type: "Decimal",
        note: "Unit sales price resolved from trade agreements or manual entry.",
      },
      {
        name: "SalesStatus",
        type: "Enum",
        note: "Line-level status mirroring the order status but tracked per-line.",
      },
    ],
  },
  InventDim: {
    name: "InventDim",
    description: "Lookup/hash table of every unique combination of inventory dimension values (site, warehouse, location, batch, serial, config, color, size).",
    module: "Inventory Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/main/inventdim",
    fields: [
      {
        name: "inventDimId",
        type: "String",
        note: "System-generated hash key identifying the unique combination of dimension values (primary key, camelCase in AOT).",
      },
      {
        name: "InventSiteId",
        type: "String",
        fkTarget: "InventSite.SiteId",
        note: "Site (plant/facility) dimension.",
      },
      {
        name: "InventLocationId",
        type: "String",
        fkTarget: "InventLocation.InventLocationId",
        note: "Warehouse identifier.",
      },
      {
        name: "wMSLocationId",
        type: "String",
        fkTarget: "WMSLocation",
        note: "Bin/aisle location within the warehouse.",
      },
      {
        name: "inventBatchId",
        type: "String",
        note: "Batch number dimension value (camelCase in AOT).",
      },
      {
        name: "inventSerialId",
        type: "String",
        note: "Serial number dimension value (camelCase in AOT).",
      },
      {
        name: "configId",
        type: "String",
        note: "Product configuration dimension value (camelCase in AOT).",
      },
    ],
  },
  InventTable: {
    name: "InventTable",
    description: "Released product (item) master per legal entity. Product-level attributes live on the shared EcoResProduct record; item group and model group are assigned per item via InventItemGroupItem and InventModelGroupItem in this D365FO version.",
    module: "Product Information Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/productinformationmanagement/main/inventtable",
    fields: [
      {
        name: "ItemId",
        type: "String",
        note: "Primary key \u2014 item number used as FK in every transaction table.",
      },
      {
        name: "ItemType",
        type: "Enum",
        note: "Item / Service / BOM \u2014 controls whether inventory transactions are created.",
      },
      {
        name: "Product",
        type: "Int64",
        fkTarget: "EcoResProduct.RecId",
        note: "FK to the shared global product definition (EcoResProduct).",
      },
      {
        name: "ItemBuyerGroupId",
        type: "String",
        fkTarget: "InventBuyerGroup.Group",
        note: "Default buyer group for procurement of this item.",
      },
      {
        name: "ProdGroupId",
        type: "String",
        fkTarget: "ProdGroup.ProdGroupId",
        note: "Default production group for this item.",
      },
      {
        name: "DefaultDimension",
        type: "Int64",
        fkTarget: "DimensionAttributeValueSet.RecId",
        note: "Default financial dimensions for inventory transactions of this item.",
      },
      {
        name: "NameAlias",
        type: "String",
        note: "Short search name used in item lookups across forms.",
      },
    ],
  },
  WHSWorkTable: {
    name: "WHSWorkTable",
    description: "Warehouse work header representing a unit of directed work (e.g. a pick-and-put instruction set) assigned to a warehouse worker.",
    module: "Warehouse Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/worksheetheader/whsworktable",
    fields: [
      {
        name: "WorkId",
        type: "String",
        note: "Primary key \u2014 work order ID assigned by WMS wave processing.",
      },
      {
        name: "WorkStatus",
        type: "Enum",
        note: "Open / InProcess / Closed / Cancelled \u2014 drives availability in the mobile device app.",
      },
      {
        name: "ShipmentId",
        type: "String",
        fkTarget: "WHSShipmentTable.ShipmentId",
        note: "Links work to the outbound shipment it fulfils.",
      },
      {
        name: "LoadId",
        type: "String",
        fkTarget: "WHSLoadTable.LoadId",
        note: "Links work to the outbound load/truck for transportation planning.",
      },
      {
        name: "OrderNum",
        type: "String",
        fkTarget: "SalesTable.SalesId",
        note: "Originating document number (sales order, purchase order, production order, transfer order) that generated the work.",
      },
      {
        name: "WaveId",
        type: "String",
        note: "Wave that created this work; used for batch processing and reporting.",
      },
    ],
  },
  WHSWorkLine: {
    name: "WHSWorkLine",
    description: "Individual pick or put step within a warehouse work order, specifying item, quantity, and source/destination location.",
    module: "Warehouse Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/worksheetline/whsworkline",
    fields: [
      {
        name: "WorkId",
        type: "String",
        fkTarget: "WHSWorkTable.WorkId",
        note: "Parent work header \u2014 part of composite logical key.",
      },
      {
        name: "LineNum",
        type: "Decimal",
        note: "Sequence within the work order (typically alternates Pick/Put pairs).",
      },
      {
        name: "WorkType",
        type: "Enum",
        note: "Pick or Put \u2014 each work order contains at least one Pick and one Put line.",
      },
      {
        name: "ItemId",
        type: "String",
        fkTarget: "InventTable.ItemId",
        note: "Item to be picked or put.",
      },
      {
        name: "InventDimId",
        type: "String",
        fkTarget: "InventDim.inventDimId",
        note: "Dimension combination (includes location, batch, serial) for this movement.",
      },
      {
        name: "QtyWork",
        type: "Decimal",
        note: "Quantity to be handled by this work line (pick/put quantity).",
      },
      {
        name: "QtyWork",
        type: "Decimal",
        note: "Actual quantity confirmed by the worker on the mobile device.",
      },
    ],
  },
  WHSShipmentTable: {
    name: "WHSShipmentTable",
    description: "Outbound shipment record grouping one or more sales order lines into a single physical shipment for carrier booking and ASN generation.",
    module: "Warehouse Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/worksheetheader/whsshipmenttable",
    fields: [
      {
        name: "ShipmentId",
        type: "String",
        note: "Primary key \u2014 shipment number.",
      },
      {
        name: "LoadId",
        type: "String",
        fkTarget: "WHSLoadTable.LoadId",
        note: "The freight load this shipment is assigned to for transportation management.",
      },
      {
        name: "OrderNum",
        type: "String",
        fkTarget: "SalesTable.SalesId",
        note: "Originating order number that generated the shipment.",
      },
      {
        name: "ShipmentStatus",
        type: "Enum",
        note: "Open / Released / Shipped / Cancelled \u2014 gates warehouse and carrier actions.",
      },
      {
        name: "CarrierCode",
        type: "String",
        note: "Carrier account booked for this shipment.",
      },
    ],
  },
  WHSLoadTable: {
    name: "WHSLoadTable",
    description: "Outbound freight load representing a truck/container load that groups multiple shipments for carrier tendering and transportation management.",
    module: "Warehouse Management / Transportation Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/worksheetheader/whsloadtable",
    fields: [
      {
        name: "LoadId",
        type: "String",
        note: "Primary key \u2014 load number.",
      },
      {
        name: "LoadStatus",
        type: "Enum",
        note: "Open / Released / Shipped / Invoiced \u2014 mirrors the outbound fulfillment lifecycle.",
      },
      {
        name: "ModeCode",
        type: "String",
        note: "Transport mode (truck, air, ocean) for rate/route determination.",
      },
      {
        name: "InventSiteId",
        type: "String",
        fkTarget: "InventSite.SiteId",
        note: "Ship-from site for load planning.",
      },
    ],
  },
  InventTrans: {
    name: "InventTrans",
    description: "Inventory subledger transaction recording every physical and financial movement of inventory (receipts, issues, picks, transfers, count adjustments).",
    module: "Inventory Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/transaction/inventtrans",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "System primary key.",
      },
      {
        name: "ItemId",
        type: "String",
        fkTarget: "InventTable.ItemId",
        note: "Item involved in the movement.",
      },
      {
        name: "inventDimId",
        type: "String",
        fkTarget: "InventDim.inventDimId",
        note: "Inventory dimension combination for the transaction (camelCase in AOT).",
      },
      {
        name: "InventTransOrigin",
        type: "Int64",
        fkTarget: "InventTransOrigin.RecId",
        note: "Link to the inventory transaction origin, which carries the transaction type and references the source document.",
      },
      {
        name: "StatusIssue",
        type: "Enum",
        note: "Issue-side status: None / ReservOrdered / ReservPhysical / Picked / Deducted / Sold.",
      },
      {
        name: "StatusReceipt",
        type: "Enum",
        note: "Receipt-side status: None / Ordered / Arrived / Received / Purchased.",
      },
      {
        name: "Qty",
        type: "Decimal",
        note: "Positive for receipts; negative for issues.",
      },
      {
        name: "CostAmountPhysical",
        type: "Decimal",
        note: "Physical cost posted when the packing slip is generated (pre-invoice).",
      },
    ],
  },
  CustInvoiceJour: {
    name: "CustInvoiceJour",
    description: "Posted customer invoice journal header for sales-order-based invoices; each row represents a single posted invoice document.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountsreceivable/transaction/custinvoicejour",
    fields: [
      {
        name: "InvoiceId",
        type: "String",
        note: "Invoice number (part of compound PK with InvoiceDate and SalesId).",
      },
      {
        name: "SalesId",
        type: "String",
        fkTarget: "SalesTable.SalesId",
        note: "Source sales order; links the invoice back to the fulfillment chain.",
      },
      {
        name: "InvoiceAccount",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Customer account to which the invoice is billed.",
      },
      {
        name: "OrderAccount",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Ordering customer (ship-to) \u2014 may differ from InvoiceAccount in third-party billing.",
      },
      {
        name: "InvoiceDate",
        type: "Date",
        note: "Posting date used for due date and aging calculations.",
      },
      {
        name: "InvoiceAmount",
        type: "Decimal",
        note: "Total invoice amount in the accounting currency.",
      },
      {
        name: "SumTax",
        type: "Decimal",
        note: "Total tax amount \u2014 detail in TaxTrans.",
      },
      {
        name: "LedgerVoucher",
        type: "String",
        note: "Voucher number of the posted general ledger entries.",
      },
    ],
  },

  CustConfirmJour: {
    name: "CustConfirmJour",
    description: "Posted sales order confirmation header; a purely documentary record with no financial (GL) impact, capturing the confirmed prices, quantities, and terms at the point of order acknowledgement.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/salesandmarketing/transaction/custconfirmjour",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "ConfirmId",
        type: "String",
        note: "Confirmation document number; unique identifier for this posted confirmation",
      },
      {
        name: "SalesId",
        type: "String",
        fkTarget: "SalesTable.SalesId",
        note: "Source sales order; links the confirmation back to the order",
      },
      {
        name: "ConfirmDate",
        type: "Date",
        note: "Date on which the confirmation was posted",
      },
      {
        name: "ConfirmAmount",
        type: "Decimal",
        note: "Total confirmed amount on the document",
      },
      {
        name: "OrderAccount",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Customer account number that placed the order",
      },
      {
        name: "InvoiceAccount",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Customer account to which the eventual invoice will be billed",
      },
      {
        name: "CurrencyCode",
        type: "String",
        note: "Currency code for all monetary amounts on this confirmation",
      },
      {
        name: "DeliveryName",
        type: "String",
        note: "Name of the delivery address for the shipment",
      },
      {
        name: "PurchaseOrder",
        type: "String",
        note: "Customer's purchase order reference number",
      },
    ],
  },

  CustConfirmTrans: {
    name: "CustConfirmTrans",
    description: "Individual line on a posted sales order confirmation; one row per confirmed sales line, holding the confirmed quantity, price, item, and inventory dimensions.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/salesandmarketing/transaction/custconfirmtrans",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "ConfirmId",
        type: "String",
        fkTarget: "CustConfirmJour.ConfirmId",
        note: "FK to the parent confirmation header document",
      },
      {
        name: "SalesId",
        type: "String",
        fkTarget: "SalesTable.SalesId",
        note: "Source sales order",
      },
      {
        name: "ItemId",
        type: "String",
        fkTarget: "InventTable.ItemId",
        note: "Item number on this confirmed line",
      },
      {
        name: "Qty",
        type: "Decimal",
        note: "Confirmed quantity in sales units",
      },
      {
        name: "InventQty",
        type: "Decimal",
        note: "Confirmed quantity in inventory units",
      },
      {
        name: "SalesPrice",
        type: "Decimal",
        note: "Unit price at the time of confirmation",
      },
      {
        name: "LineAmount",
        type: "Decimal",
        note: "Net line amount (qty x price minus discounts)",
      },
      {
        name: "InventDimId",
        type: "String",
        fkTarget: "InventDim.inventDimId",
        note: "Inventory dimension combination (site, warehouse, batch, etc.)",
      },
      {
        name: "InventTransId",
        type: "String",
        fkTarget: "InventTransOrigin.InventTransId",
        note: "Inventory transaction ID linking to the underlying inventory movement",
      },
    ],
  },

  CustPackingSlipJour: {
    name: "CustPackingSlipJour",
    description: "Posted delivery note (packing slip) header; created when goods are physically shipped from the warehouse. Unlike confirmations, this document has financial impact — it triggers inventory cost-of-goods-sold postings in the GL.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/salesandmarketing/transaction/custpackingslipjour",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "PackingSlipId",
        type: "String",
        note: "Packing slip document number; unique identifier for this posted delivery note",
      },
      {
        name: "SalesId",
        type: "String",
        fkTarget: "SalesTable.SalesId",
        note: "Source sales order; links the delivery note back to the order",
      },
      {
        name: "DeliveryDate",
        type: "Date",
        note: "Actual date of physical shipment/delivery",
      },
      {
        name: "OrderAccount",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Customer account that placed the order",
      },
      {
        name: "InvoiceAccount",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Customer account to be invoiced",
      },
      {
        name: "LedgerVoucher",
        type: "String",
        note: "GL voucher number for the inventory COGS posting triggered by this shipment",
      },
      {
        name: "DocumentDate",
        type: "Date",
        note: "Document date on the packing slip (may differ from DeliveryDate)",
      },
      {
        name: "DlvMode",
        type: "String",
        fkTarget: "DlvMode.Code",
        note: "Mode of delivery (e.g. truck, air, courier)",
      },
      {
        name: "SourceDocumentHeader",
        type: "Int64",
        note: "FK to the source document header used for accounting framework integration",
      },
    ],
  },

  CustPackingSlipTrans: {
    name: "CustPackingSlipTrans",
    description: "Individual line on a posted delivery note (packing slip); one row per shipped item line, holding the delivered quantity, item, inventory dimensions, and the remaining quantity not yet invoiced.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/salesandmarketing/transaction/custpackingsliptrans",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "PackingSlipId",
        type: "String",
        fkTarget: "CustPackingSlipJour.PackingSlipId",
        note: "FK to the parent packing slip header document",
      },
      {
        name: "SalesId",
        type: "String",
        fkTarget: "SalesTable.SalesId",
        note: "Source sales order",
      },
      {
        name: "ItemId",
        type: "String",
        fkTarget: "InventTable.ItemId",
        note: "Item number on this shipped line",
      },
      {
        name: "Qty",
        type: "Decimal",
        note: "Delivered quantity in sales units",
      },
      {
        name: "inventQty",
        type: "Decimal",
        note: "Delivered quantity in inventory units",
      },
      {
        name: "Remain",
        type: "Decimal",
        note: "Quantity from this packing slip line not yet invoiced",
      },
      {
        name: "InventDimId",
        type: "String",
        fkTarget: "InventDim.inventDimId",
        note: "Inventory dimension combination (site, warehouse, batch, serial, etc.)",
      },
      {
        name: "InventTransId",
        type: "String",
        fkTarget: "InventTransOrigin.InventTransId",
        note: "Inventory transaction ID linking to the physical inventory issue",
      },
      {
        name: "AmountCur",
        type: "Decimal",
        note: "Line amount in the transaction currency (used for packing-slip-level valuation)",
      },
    ],
  },
  CustInvoiceTable: {
    name: "CustInvoiceTable",
    description: "Free text invoice header for AR invoices not sourced from a sales order (e.g. recurring charges, service fees). Lines live in CustInvoiceLine. After posting, the header is recorded in CustInvoiceJour.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountsreceivable/worksheetheader/custinvoicetable",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "System primary key.",
      },
      {
        name: "InvoiceId",
        type: "String",
        note: "User-assigned or sequence-generated invoice number.",
      },
      {
        name: "OrderAccount",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Customer account for the free text invoice (stored in OrderAccount).",
      },
      {
        name: "InvoiceDate",
        type: "Date",
        note: "Posting and AR aging date.",
      },
      {
        name: "Payment",
        type: "String",
        fkTarget: "PaymTerm.PaymTermId",
        note: "Default payment terms for the free text invoice.",
      },
      {
        name: "DueDate",
        type: "Date",
        note: "Calculated payment due date based on PaymTermId.",
      },
      {
        name: "CurrencyCode",
        type: "String",
        fkTarget: "Currency",
        note: "Invoice transaction currency.",
      },
    ],
  },
  CustInvoiceLine: {
    name: "CustInvoiceLine",
    description: "Free text invoice line (draft, pre-posting). Each row is one line on a CustInvoiceTable header, holding the revenue account and amount. After the FTI is posted, line data is recorded in CustInvoiceTrans and the header moves to CustInvoiceJour. FTI lines use a ledger account (LedgerDimension) directly — there is no ItemId.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountsreceivable/worksheetline/custinvoiceline",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "System primary key.",
      },
      {
        name: "ParentRecId",
        type: "Int64",
        fkTarget: "CustInvoiceTable.RecId",
        note: "FK to the parent CustInvoiceTable header. Compound display key is (ParentRecId, LineNum).",
      },
      {
        name: "LineNum",
        type: "Decimal",
        note: "Display sequence number on the invoice.",
      },
      {
        name: "Description",
        type: "String",
        note: "Free-text line description printed on the customer invoice.",
      },
      {
        name: "LedgerDimension",
        type: "Int64",
        note: "Ledger account + financial dimensions combination (DimensionAttributeValueCombination). FTI lines credit a revenue account directly — no ItemId.",
      },
      {
        name: "AmountCur",
        type: "Decimal",
        note: "Line amount in transaction currency (Quantity × UnitPrice, before tax).",
      },
      {
        name: "Quantity",
        type: "Decimal",
        note: "Invoiced quantity.",
      },
      {
        name: "UnitPrice",
        type: "Decimal",
        note: "Unit price for the line.",
      },
      {
        name: "TaxGroup",
        type: "String",
        fkTarget: "TaxGroupHeading",
        note: "Sales tax group; combined with TaxItemGroup to resolve applicable tax codes.",
      },
      {
        name: "TaxItemGroup",
        type: "String",
        note: "Item sales tax group on the line.",
      },
      {
        name: "CurrencyCode",
        type: "String",
        fkTarget: "Currency",
        note: "Transaction currency — inherited from the CustInvoiceTable header.",
      },
      {
        name: "ProjId",
        type: "String",
        note: "Optional project reference; populated when the FTI is generated from project invoicing.",
      },
    ],
  },
  CustInvoiceTrans: {
    name: "CustInvoiceTrans",
    description: "Customer invoice line detail table used for both sales-order invoices and free text invoices.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountsreceivable/transaction/custinvoicetrans",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "System primary key.",
      },
      {
        name: "InvoiceId",
        type: "String",
        fkTarget: "CustInvoiceJour.InvoiceId",
        note: "Parent invoice reference \u2014 joins to CustInvoiceJour (SO invoice) or CustInvoiceTable (FTI).",
      },
      {
        name: "SalesId",
        type: "String",
        fkTarget: "SalesTable.SalesId",
        note: "Source sales order; null for free text invoices.",
      },
      {
        name: "ItemId",
        type: "String",
        fkTarget: "InventTable.ItemId",
        note: "Invoiced item; may be null for free text invoice lines using ledger accounts.",
      },
      {
        name: "Qty",
        type: "Decimal",
        note: "Invoiced quantity.",
      },
      {
        name: "SalesPrice",
        type: "Decimal",
        note: "Unit price as invoiced.",
      },
      {
        name: "LineAmount",
        type: "Decimal",
        note: "Qty \u00d7 SalesPrice minus discounts.",
      },
      {
        name: "TaxGroup",
        type: "String",
        fkTarget: "TaxGroupHeading",
        note: "Sales tax group on the line; combined with item tax group for tax calculation.",
      },
    ],
  },
  CustTrans: {
    name: "CustTrans",
    description: "Customer AR subledger transaction \u2014 one row per financial posting event (invoice, payment, credit note, interest) against a customer account.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountsreceivable/transaction/custtrans",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "System primary key; referenced as FK by CustSettlement.",
      },
      {
        name: "AccountNum",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Customer account this transaction is posted against.",
      },
      {
        name: "Invoice",
        type: "String",
        note: "Invoice number for lookup/matching \u2014 populated on invoice postings and payment references.",
      },
      {
        name: "AmountCur",
        type: "Decimal",
        note: "Amount in the transaction currency (positive = customer owes, negative = credit).",
      },
      {
        name: "TransDate",
        type: "Date",
        note: "Transaction posting date used for aging and due-date calculation.",
      },
      {
        name: "Voucher",
        type: "String",
        note: "GL voucher number tying this AR entry to the general ledger.",
      },
      {
        name: "TransType",
        type: "Enum",
        note: "Invoice / Payment / CreditNote / Interest / WriteOff / etc.",
      },
      {
        name: "Closed",
        type: "Date",
        note: "Date the transaction was fully settled; null when an open balance remains.",
      },
    ],
  },
  TaxTrans: {
    name: "TaxTrans",
    description: "Tax subledger transaction recording per-tax-code amounts for every voucher that has a taxable event (invoices, payments with tax, etc.).",
    module: "Tax",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/tax/transaction/taxtrans",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "System primary key.",
      },
      {
        name: "Voucher",
        type: "String",
        note: "GL voucher number \u2014 joins this row to CustInvoiceJour.Voucher or LedgerJournalTrans.Voucher.",
      },
      {
        name: "TaxCode",
        type: "String",
        fkTarget: "TaxTable.TaxCode",
        note: "Tax code master defining rate, account, and reporting attributes.",
      },
      {
        name: "TaxAmount",
        type: "Decimal",
        note: "Calculated tax amount in the tax currency.",
      },
      {
        name: "TaxBaseAmount",
        type: "Decimal",
        note: "Taxable base amount the tax was calculated on.",
      },
      {
        name: "TransDate",
        type: "Date",
        note: "Transaction date matching the source document posting date.",
      },
      {
        name: "SourceTableId",
        type: "Int",
        note: "SysTableId of the originating table (e.g. CustInvoiceTrans) for traceability.",
      },
      {
        name: "SourceRecId",
        type: "Int64",
        note: "RecId of the originating line record for direct back-reference.",
      },
    ],
  },

  TaxTable: {
    name: "TaxTable",
    description: "Sales tax code setup table. Each row defines one tax code (e.g. 'VAT20') including its calculation method, rate basis, settlement period, and posting account group. Tax codes are the atomic unit of tax calculation; they are collected into sales tax groups (TaxGroupHeading) and item sales tax groups (TaxItemGroupHeading) whose intersection determines which codes actually apply to a transaction.",
    module: "Tax",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/tax/group/taxtable",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "TaxCode",
        type: "String",
        note: "Natural primary key — tax code identifier (e.g. 'VAT20', 'USE_TAX')",
      },
      {
        name: "TaxName",
        type: "String",
        note: "Human-readable description of the tax code",
      },
      {
        name: "TaxAccountGroup",
        type: "String",
        fkTarget: "TaxLedgerAccountGroup.TaxAccountGroup",
        note: "FK to the ledger posting account group that defines which GL accounts receive this tax",
      },
      {
        name: "TaxCurrencyCode",
        type: "String",
        fkTarget: "Currency.CurrencyCode",
        note: "Currency in which tax values are expressed for this code",
      },
      {
        name: "TaxPeriod",
        type: "String",
        fkTarget: "TaxPeriodHead.TaxPeriod",
        note: "FK to the settlement period (TaxPeriodHead) controlling when this tax is settled against the authority",
      },
      {
        name: "TaxCalcMethod",
        type: "Enum",
        note: "Calculation method enum: 0=Whole amount, 1=Interval, 2=Whole amount per unit, 3=Interval per unit",
      },
      {
        name: "TaxBase",
        type: "Enum",
        note: "Tax base enum: determines whether tax is calculated as a percentage of net amount, gross amount, or a fixed amount per unit",
      },
      {
        name: "TaxRoundOff",
        type: "Decimal",
        note: "Rounding precision for calculated tax amounts (e.g. 0.01 for cent-level rounding)",
      },
      {
        name: "TaxOnTax",
        type: "String",
        fkTarget: "TaxTable.TaxCode",
        note: "Optional self-referential FK: if set, tax is calculated on top of another tax code (sales tax on sales tax)",
      },
    ],
  },

  TaxGroupHeading: {
    name: "TaxGroupHeading",
    description: "Sales tax group header table. Each row defines a named group (e.g. 'EU-B2B', 'DOMESTIC') that represents a set of applicable tax codes for a customer, vendor, or transaction. Tax codes in both the sales tax group and the item sales tax group (TaxItemGroupHeading) are intersected to determine which codes are actually calculated on a given transaction line.",
    module: "Tax",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/tax/group/taxgroupheading",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "TaxGroup",
        type: "String",
        note: "Natural primary key — sales tax group identifier (e.g. 'EU-B2B', 'DOMESTIC')",
      },
      {
        name: "TaxGroupName",
        type: "String",
        note: "Human-readable description of the tax group",
      },
      {
        name: "TaxGroupSetup",
        type: "Enum",
        note: "Tax direction enum controlling whether this group applies to sales, purchases, or both",
      },
      {
        name: "TaxGroupRounding",
        type: "Enum",
        note: "Rounding rule enum applied when summing multiple tax codes within this group",
      },
      {
        name: "TaxPrintDetail",
        type: "Enum",
        note: "Controls level of tax detail printed on documents: 0=Summary, 1=Per tax code, 2=Full detail",
      },
      {
        name: "TaxReverseOnCashDisc",
        type: "Enum",
        note: "Indicates whether tax is reversed when a cash discount is taken (relevant for VAT jurisdictions)",
      },
      {
        name: "EUTrade_W",
        type: "Enum",
        note: "Flags this group as EU intra-community trade for EU sales list reporting purposes",
      },
    ],
  },

  TaxItemGroupHeading: {
    name: "TaxItemGroupHeading",
    description: "Item sales tax group table. Each row defines a named group (e.g. 'FULL', 'REDUCED', 'EXEMPT') that classifies items by their tax treatment. Only tax codes present in both the transaction's sales tax group (TaxGroupHeading) and the item's item sales tax group are calculated — this intersection logic drives conditional tax application (e.g. zero-rating exempt goods for EU customers).",
    module: "Tax",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/tax/group/taxitemgroupheading",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "TaxItemGroup",
        type: "String",
        note: "Natural primary key — item sales tax group identifier (e.g. 'FULL', 'REDUCED', 'EXEMPT')",
      },
      {
        name: "Name",
        type: "String",
        note: "Human-readable description of the item tax group",
      },
      {
        name: "EUSalesListType",
        type: "Enum",
        note: "Classifies EU sales list reporting type for items in this group: 0=None, 1=Item, 2=Service, 3=Investment",
      },
    ],
  },

  TaxGroup: {
    name: "TaxGroup",
    description: "Sales tax group header - defines the set of tax codes applicable to a customer, vendor, or transaction. The D365FO table is TaxGroupHeading.",
    module: "Tax",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/tax/group/taxgroupheading",
    fields: [
      { name: "TaxGroup", type: "String", note: "Sales tax group code (primary key)." },
      { name: "TaxGroupName", type: "String", note: "Name of the sales tax group." },
      { name: "TaxGroupRounding", type: "Enum", note: "Rounding method applied to tax amounts for the group." },
      { name: "TaxGroupSetup", type: "Enum", note: "Tax calculation setup variant for the group (standard, India, etc.)." },
      { name: "TaxPrintDetail", type: "Enum", note: "Level of tax detail printed on documents for this group." },
    ],
  },

  CustSettlement: {
    name: "CustSettlement",
    description: "Links an AR invoice transaction to the payment (or other offset) transaction that settles it, recording the settled amount and date.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/dynamics365/finance/cash-bank-management/settlement-overview",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "System primary key.",
      },
      {
        name: "TransRecId",
        type: "Int64",
        fkTarget: "CustTrans.RecId",
        note: "Invoice-side CustTrans record being settled.",
      },
      {
        name: "OffsetRecid",
        type: "Int64",
        fkTarget: "CustTrans.RecId",
        note: "RecId of the offset (payment/credit) CustTrans transaction.",
      },
      {
        name: "SettleAmountCur",
        type: "Decimal",
        note: "Amount settled in the transaction currency (partial settlements create multiple rows).",
      },
      {
        name: "TransDate",
        type: "Date",
        note: "Date the settlement was applied.",
      },
      {
        name: "TransOpen",
        type: "Int64",
        note: "Reference to the settlement group record while the settlement is open.",
      },
    ],
  },
  LedgerJournalTable: {
    name: "LedgerJournalTable",
    description: "Journal batch header controlling type, name, approval status, and posting flag for a group of LedgerJournalTrans lines.",
    module: "General Ledger / Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountingfoundation/worksheetheader/ledgerjournaltable",
    fields: [
      {
        name: "JournalNum",
        type: "String",
        note: "Primary key \u2014 journal batch number from number sequence.",
      },
      {
        name: "JournalType",
        type: "Enum",
        note: "Daily / Customer / Vendor / Bank / etc. \u2014 controls which account types are allowed on lines.",
      },
      {
        name: "JournalName",
        type: "String",
        fkTarget: "LedgerJournalName",
        note: "Journal name template providing default offset account and approval settings.",
      },
      {
        name: "Posted",
        type: "NoYes",
        note: "1 once the batch has been posted to the GL; prevents further edits.",
      },
      {
        name: "NumOfLines",
        type: "Int",
        note: "Number of lines in the journal header.",
      },
    ],
  },
  LedgerJournalTrans: {
    name: "LedgerJournalTrans",
    description: "Individual debit or credit journal line; for customer payment journals each line targets a customer account and vouches to the GL.",
    module: "General Ledger / Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountingfoundation/worksheetline/ledgerjournaltrans",
    fields: [
      {
        name: "JournalNum",
        type: "String",
        fkTarget: "LedgerJournalTable.JournalNum",
        note: "Parent journal batch \u2014 composite logical PK with LineNum.",
      },
      {
        name: "LineNum",
        type: "Decimal",
        note: "Sequence number within the journal batch.",
      },
      {
        name: "AccountType",
        type: "Enum",
        note: "Ledger / Customer / Vendor / Bank / FixedAsset \u2014 determines FK target of AccountNum.",
      },
      {
        name: "LedgerDimension",
        type: "Int64",
        fkTarget: "DimensionAttributeValueCombination.RecId",
        note: "Posting account of the journal line, resolved to a ledger dimension (main account + financial dimensions).",
      },
      {
        name: "AmountCurDebit",
        type: "Decimal",
        note: "Debit amount in transaction currency.",
      },
      {
        name: "AmountCurCredit",
        type: "Decimal",
        note: "Credit amount in transaction currency.",
      },
      {
        name: "Voucher",
        type: "String",
        note: "Voucher number shared with the corresponding CustTrans row after posting.",
      },
      {
        name: "TransDate",
        type: "Date",
        note: "Transaction date posted to the general ledger.",
      },
    ],
  },
  BankAccountTable: {
    name: "BankAccountTable",
    description: "Company bank account master defining account numbers, bank group, currency, and routing details for payment disbursement.",
    module: "Cash and Bank Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/bank/main/bankaccounttable",
    fields: [
      {
        name: "AccountID",
        type: "String",
        note: "Bank account identifier (primary key, capital ID in AOT).",
      },
      {
        name: "AccountNum",
        type: "String",
        note: "Actual bank account number at the financial institution.",
      },
      {
        name: "BankGroupId",
        type: "String",
        fkTarget: "BankGroup.BankGroupId",
        note: "Bank group providing routing number, bank name, and GL posting profile.",
      },
      {
        name: "CurrencyCode",
        type: "String",
        fkTarget: "Currency",
        note: "Denominated currency of this bank account.",
      },
      {
        name: "BankAccountStatus",
        type: "Enum",
        note: "Hold status of the bank account (active or on hold).",
      },
      {
        name: "IBAN",
        type: "String",
        note: "International Bank Account Number for the account.",
      },
    ],
  },

  BankAccountTrans: {
    name: "BankAccountTrans",
    description: "Individual bank transaction line — deposits, withdrawals, fees, and corrections posted via payment journals. Each row represents one movement on a bank account and is linked to a GL voucher via the Voucher field.",
    module: "Cash and Bank Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/bank/transaction/bankaccounttrans",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "AccountId",
        type: "String",
        fkTarget: "BankAccountTable.AccountID",
        note: "FK to the bank account this transaction belongs to",
      },
      {
        name: "CurrencyCode",
        type: "String",
        fkTarget: "Currency.CurrencyCode",
        note: "Denominated currency of the transaction",
      },
      {
        name: "TransDate",
        type: "Date",
        note: "Date of the bank transaction",
      },
      {
        name: "Voucher",
        type: "String",
        note: "Voucher number linking to the GL GeneralJournalEntry",
      },
      {
        name: "AmountCur",
        type: "Decimal",
        note: "Transaction amount in the original currency",
      },
      {
        name: "AmountMST",
        type: "Decimal",
        note: "Transaction amount in the accounting (home) currency",
      },
      {
        name: "BankTransType",
        type: "String",
        note: "Bank transaction type (e.g. Cheque, Transfer, Wire)",
      },
      {
        name: "Reconciled",
        type: "Int32",
        note: "Reconciliation status flag (0 = not reconciled, 1 = reconciled)",
      },
      {
        name: "Txt",
        type: "String",
        note: "Free-text description or memo on the transaction",
      },
    ],
  },

  CashDisc: {
    name: "CashDisc",
    description: "Cash discount terms master — defines the percentage discount and payment window (number of days or months) that a customer can claim by paying early. Referenced by CustTrans and VendTrans during invoice settlement.",
    module: "Cash and Bank Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/bank/group/cashdisc",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "CashDiscCode",
        type: "String",
        note: "Primary key — unique code identifying this cash discount schedule",
      },
      {
        name: "Description",
        type: "String",
        note: "Human-readable description of the discount terms",
      },
      {
        name: "DiscMethod",
        type: "Int32",
        note: "Enum: 0 = Percentage, 1 = Fixed amount",
      },
      {
        name: "Percent",
        type: "Decimal",
        note: "Discount percentage offered if paid within the window",
      },
      {
        name: "NumOfDays",
        type: "Int32",
        note: "Number of days within which payment must be received to qualify",
      },
      {
        name: "NumOfMonths",
        type: "Int32",
        note: "Number of months (alternative to NumOfDays) for the discount window",
      },
      {
        name: "CashDiscCodeNext",
        type: "String",
        fkTarget: "CashDisc.CashDiscCode",
        note: "Optional link to a follow-on discount code for sequential discount tiers",
      },
    ],
  },
  // ── P2P tables ──────────────────────────────
  PurchReqTable: {
    name: "PurchReqTable",
    description: "Purchase requisition header. Tracks the requisition document submitted by an employee requesting goods or services, through workflow approval.",
    module: "Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/procurementandsourcing/worksheetheader/purchreqtable",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "PurchReqId", type: "String", note: "Human-readable requisition number (e.g. PR-000123); business key" },
      { name: "PurchReqName", type: "String", note: "Description / title of the requisition" },
      { name: "RequisitionStatus", type: "Int32", note: "Enum: Draft=0, InReview=1, Approved=2, Closed=3, Cancelled=4" },
      { name: "RequisitionPurpose", type: "Int32", note: "Enum: Consumption=0 (generates PO), Replenishment=1 (feeds master plan)" },
      { name: "RequiredDate", type: "Date", note: "Requested delivery date across the requisition" },
      { name: "Originator", type: "Int64", fkTarget: "HcmWorker.RecId", note: "Worker who created the requisition" },
      { name: "TransDate", type: "Date", note: "Document date (date entered)" },
      { name: "SubmittedDateTime", type: "Date", note: "Timestamp when submitted to workflow; read-only" },
    ],
  },

  PurchReqLine: {
    name: "PurchReqLine",
    description: "Purchase requisition line. Each line represents a single item or service requested, with quantity, price, preferred vendor, and financial dimensions.",
    module: "Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/procurementandsourcing/worksheetline/purchreqline",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "PurchReqTable", type: "Int64", fkTarget: "PurchReqTable.RecId", note: "FK to the parent purchase requisition header (RecId)." },
      { name: "LineNum", type: "Decimal", note: "Line number within the requisition." },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Product/item being requested; null if procurement category used" },
      { name: "VendAccount", type: "String", fkTarget: "VendTable.AccountNum", note: "Preferred vendor suggested by requester; not binding" },
      { name: "PurchQty", type: "Decimal", note: "Requested quantity." },
      { name: "PurchPrice", type: "Decimal", note: "Unit price requested for the item." },
      { name: "LineAmount", type: "Decimal", note: "Qty × Price; net line amount before tax" },
      { name: "PurchReqConsolidationStatus", type: "Int32", note: "Enum indicating if line is in a consolidation opportunity for demand aggregation" },
    ],
  },

  VendTable: {
    name: "VendTable",
    description: "Vendor master. Central record for each supplier including payment terms, currency, tax group, and hold status. Keyed by account number within the legal entity.",
    module: "Accounts Payable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/vendor/main/vendtable",
    fields: [
      { name: "AccountNum", type: "String", note: "Vendor account number; natural/business primary key" },
      { name: "VendGroup", type: "String", fkTarget: "VendGroup.VendGroup", note: "Vendor group; drives posting profiles and policies" },
      { name: "Currency", type: "String", fkTarget: "Currency.CurrencyCode", note: "Default transaction currency for invoices and payments issued to this vendor." },
      { name: "PaymTermId", type: "String", fkTarget: "PaymTerm.PaymTermId", note: "Default payment terms (e.g. Net30)" },
      { name: "DlvTerm", type: "String", fkTarget: "DlvTerm.Code", note: "Default delivery terms for purchase orders from this vendor." },
      { name: "TaxGroup", type: "String", fkTarget: "TaxGroupHeading.TaxGroup", note: "Sales-tax group applied to vendor transactions" },
      { name: "Blocked", type: "Enum", note: "Hold status: No, Collection, All (invoice and payment blocking)." },
      { name: "OneTimeVendor", type: "Enum", note: "Flag for auto-created one-time vendor accounts" },
    ],
  },

  PurchTable: {
    name: "PurchTable",
    description: "Purchase order header. Represents the external order agreement with a vendor, including order/invoice account, currency, payment terms, and overall order status.",
    module: "Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/procurementandsourcing/worksheetheader/purchtable",
    fields: [
      { name: "PurchId", type: "String", note: "Purchase order number; natural primary key (e.g. PO-000456)" },
      { name: "OrderAccount", type: "String", fkTarget: "VendTable.AccountNum", note: "Vendor account placing the order from; drives default fields" },
      { name: "InvoiceAccount", type: "String", fkTarget: "VendTable.AccountNum", note: "Vendor account for invoicing (may differ from OrderAccount)" },
      { name: "PurchStatus", type: "Int32", note: "Enum: None=0, Backorder=1, Received=2, Invoiced=3, Canceled=4 (AOT symbols; Backorder is displayed as \"Open order\")" },
      { name: "DocumentStatus", type: "Int32", note: "Enum tracks document progress: None, PurchaseOrder, ProductReceipt, Invoice" },
      { name: "CurrencyCode", type: "String", fkTarget: "Currency.CurrencyCode", note: "Transaction currency for the order" },
      { name: "Payment", type: "String", fkTarget: "PaymTerm.PaymTermId", note: "Default payment terms for the purchase order." },
      { name: "DeliveryDate", type: "Date", note: "Requested delivery date on the header" },
    ],
  },

  PurchAgreementTable: {
    name: "PurchAgreementTable",
    description: "Purchase agreement (blanket purchase order) header. In D365FO stored in the shared AgreementHeader table with the PurchAgreement classification. Purchase orders released against the agreement inherit negotiated prices and track fulfilment against committed totals.",
    module: "Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/supply-chain/procurement/purchase-agreements",
    fields: [
      {
        name: "AgreementClassification",
        type: "Int64",
        fkTarget: "AgreementClassification.RecId",
        note: "Agreement classification (PurchAgreement) that identifies this as a purchase agreement.",
      },
      {
        name: "Currency",
        type: "String",
        fkTarget: "Currency.CurrencyCode",
        note: "Currency of the agreement.",
      },
      {
        name: "DefaultDimension",
        type: "Int64",
        fkTarget: "DimensionAttributeValueSet.RecId",
        note: "Default financial dimensions for the agreement.",
      },
      {
        name: "DocumentTitle",
        type: "String",
        note: "Agreement title.",
      },
      {
        name: "EarliestLineEffectiveDate",
        type: "Date",
        note: "Earliest effective date across all agreement lines.",
      },
      {
        name: "LatestLineExpirationDate",
        type: "Date",
        note: "Latest expiration date across all agreement lines.",
      },
      {
        name: "AgreementState",
        type: "Enum",
        note: "State of the agreement (validated, on hold, closed, etc.).",
      },
    ],
  },

  PurchAgreementLine: {
    name: "PurchAgreementLine",
    description: "Purchase agreement commitment line. In D365FO stored in the shared AgreementLine table under a PurchAgreement-classified AgreementHeader; each line specifies a quantity or value commitment for an item. Released purchase order lines consume the committed quantity/amount.",
    module: "Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/supply-chain/procurement/purchase-agreements",
    fields: [
      {
        name: "Agreement",
        type: "Int64",
        fkTarget: "AgreementHeader.RecId",
        note: "FK to the parent agreement header.",
      },
      {
        name: "AgreementLineType",
        type: "Enum",
        note: "Line type: item or category commitment.",
      },
      {
        name: "ItemId",
        type: "String",
        fkTarget: "InventTable.ItemId",
        note: "Item the commitment applies to.",
      },
      {
        name: "Category",
        type: "Int64",
        fkTarget: "EcoResCategory.RecId",
        note: "Procurement/sales category the commitment applies to.",
      },
      {
        name: "LineNumber",
        type: "Decimal",
        note: "Line number within the agreement.",
      },
      {
        name: "EffectiveDate",
        type: "Date",
        note: "Start of the commitment period.",
      },
      {
        name: "ExpirationDate",
        type: "Date",
        note: "End of the commitment period.",
      },
      {
        name: "IsMaxEnforced",
        type: "Enum",
        note: "Whether the commitment quantity/amount is a maximum that cannot be exceeded.",
      },
    ],
  },

  PurchLine: {
    name: "PurchLine",
    description: "Purchase order line. Each line specifies a product/category, quantity, price, storage dimensions, and financial dimensions for one ordered item on the PO.",
    module: "Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/procurementandsourcing/worksheetline/purchline",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "PurchId", type: "String", fkTarget: "PurchTable.PurchId", note: "Links line to purchase order header" },
      { name: "LineNumber", type: "Int64", note: "Line number within the purchase order; EDT TradeLineNumber. VendInvoiceTrans.PurchaseLineLineNumber matches this field" },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Product ordered; null if procurement category line" },
      { name: "InventDimId", type: "String", fkTarget: "InventDim.inventDimId", note: "Inventory dimension combination (site, warehouse, batch, serial, etc.)" },
      { name: "PurchQty", type: "Decimal", note: "Ordered quantity in purchase unit of measure" },
      { name: "PurchPrice", type: "Decimal", note: "Agreed unit price in order currency" },
      { name: "LineAmount", type: "Decimal", note: "Net line amount (PurchQty × PurchPrice after discounts)" },
      { name: "RemainPurchPhysical", type: "Decimal", note: "Quantity not yet received; decrements on each product receipt" },
    ],
  },

  ChargesSetup: {
    name: "ChargesSetup",
    description: "Auto charges setup (MarkupAutoTable in D365FO) - defines charge codes automatically applied to orders based on account, item, and delivery mode scope.",
    module: "Accounts Receivable / Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/dynamics365/supply-chain/procurement/automatic-charges-allocation",
    fields: [
      { name: "AccountCode", type: "Enum", note: "Scope of the auto charge: table (customer/vendor), group, or all." },
      { name: "AccountRelation", type: "String", fkTarget: "CustTable.AccountNum", note: "Customer or vendor (or group) the auto charge applies to." },
      { name: "ItemCode", type: "Enum", note: "Scope of the item: table (item), group, or all." },
      { name: "ItemRelation", type: "String", fkTarget: "InventTable.ItemId", note: "Item (or item group) the auto charge applies to." },
      { name: "DlvModeCode", type: "String", fkTarget: "DlvMode.Code", note: "Mode of delivery the auto charge applies to." },
      { name: "ModuleCategory", type: "Enum", note: "Module the charge applies to (customer, vendor, etc.)." },
      { name: "ModuleType", type: "Enum", note: "Document type (sales order, purchase order, etc.)." },
      { name: "Description", type: "String", note: "Description of the auto charge." },
    ],
  },

  VendPackingSlipJour: {
    name: "VendPackingSlipJour",
    description: "Vendor product receipt journal header. Created when a PO product receipt is posted; represents one physical delivery event from the vendor (one packing slip).",
    module: "Procurement and Sourcing / Accounts Payable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/procurementandsourcing/transaction/vendpackingslipjour",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "PurchId", type: "String", fkTarget: "PurchTable.PurchId", note: "Purchase order against which this receipt was posted" },
      { name: "PackingSlipId", type: "String", note: "Vendor's packing slip / delivery note number; required for matching" },
      { name: "DeliveryDate", type: "Date", note: "Actual physical delivery date recorded at receipt" },
      { name: "InvoiceAccount", type: "String", fkTarget: "VendTable.AccountNum", note: "Invoice vendor account (may differ from ordering vendor)" },
    ],
  },

  VendPackingSlipTrans: {
    name: "VendPackingSlipTrans",
    description: "Vendor product receipt lines. Each record represents one PO line quantity received within a specific product receipt (packing slip) posting.",
    module: "Procurement and Sourcing / Accounts Payable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/procurementandsourcing/transaction/vendpackingsliptrans",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "VendPackingSlipJour", type: "Int64", fkTarget: "VendPackingSlipJour.RecId", note: "FK to the receipt journal header; groups lines under one delivery" },
      { name: "LineNum", type: "Decimal", fkTarget: "PurchLine.LineNumber", note: "Matches PurchLine.LineNum to identify the PO line received" },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Product received on this line" },
      { name: "Qty", type: "Decimal", note: "Physical quantity received in purchase unit of measure" },
      { name: "InventTransId", type: "String", fkTarget: "InventTransOrigin.InventTransId", note: "Links to the inventory transaction that updated on-hand stock" },
      { name: "InventDimId", type: "String", fkTarget: "InventDim.inventDimId", note: "Dimension combination for the received stock" },
    ],
  },

  VendInvoiceJour: {
    name: "VendInvoiceJour",
    description: "Posted vendor invoice journal header. Created when a vendor invoice is confirmed and posted; records the invoice amount, accounting date, and voucher that hits the GL and subledger.",
    module: "Accounts Payable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountspayable/transaction/vendinvoicejour",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "InvoiceId", type: "String", note: "Vendor's invoice number; used for duplicate-invoice detection" },
      { name: "PurchId", type: "String", fkTarget: "PurchTable.PurchId", note: "PO against which the invoice is matched; null for non-PO invoices" },
      { name: "InvoiceDate", type: "Date", note: "Date on the vendor's paper invoice; drives due-date calculation" },
      { name: "InvoiceAmountMST", type: "Decimal", note: "Invoice total in accounting (MST) currency" },
      { name: "CurrencyCode", type: "String", fkTarget: "Currency.CurrencyCode", note: "Invoice transaction currency" },
    ],
  },

  VendInvoiceInfoTable: {
    name: "VendInvoiceInfoTable",
    description: "Pending (unposted) vendor invoice header; the AP equivalent of CustInvoiceTable. Captures the vendor invoice as entered or received before it is posted to the ledger. After posting, header data moves to VendInvoiceJour.",
    module: "Accounts Payable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountspayable/transactionheader/vendinvoiceinfotable",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "ParmId",
        type: "String",
        note: "Internal parameter key linking this header to its VendInvoiceInfoLine rows and the posting session",
      },
      {
        name: "PurchId",
        type: "String",
        fkTarget: "PurchTable.PurchId",
        note: "Purchase order being invoiced; null for non-PO (standalone) vendor invoices",
      },
      {
        name: "OrderAccount",
        type: "String",
        fkTarget: "VendTable.AccountNum",
        note: "Vendor account that submitted the invoice",
      },
      {
        name: "InvoiceAccount",
        type: "String",
        fkTarget: "VendTable.AccountNum",
        note: "Vendor account to be invoiced (may differ from OrderAccount for intercompany)",
      },
      {
        name: "DocumentNum",
        type: "String",
        note: "Vendor's invoice document number; used for duplicate-invoice detection",
      },
      {
        name: "DocumentDate",
        type: "Date",
        note: "Date on the vendor's invoice document",
      },
      {
        name: "CurrencyCode",
        type: "String",
        note: "Currency code for all monetary amounts on this invoice",
      },
      {
        name: "MatchStatus",
        type: "Enum",
        note: "Enum: invoice-to-PO matching status (Passed, Failed, Not applicable, etc.)",
      },
      {
        name: "Approved",
        type: "Enum",
        note: "1 if the invoice has been approved for posting; 0 if pending review",
      },
    ],
  },

  VendInvoiceInfoLine: {
    name: "VendInvoiceInfoLine",
    description: "Individual line on a pending (unposted) vendor invoice; the AP equivalent of CustInvoiceLine. Each row holds one invoiced item or procurement category with quantity, price, and accounting. After posting, line data moves to VendInvoiceTrans.",
    module: "Accounts Payable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountspayable/transactionline/vendinvoiceinfoline",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "ParmId",
        type: "String",
        fkTarget: "VendInvoiceInfoTable.ParmId",
        note: "FK to the parent pending invoice header via the posting session parameter key",
      },
      {
        name: "ItemId",
        type: "String",
        fkTarget: "InventTable.ItemId",
        note: "Item number on this invoice line; null for procurement-category-only lines",
      },
      {
        name: "ProcurementCategory",
        type: "Int64",
        fkTarget: "EcoResCategory.RecId",
        note: "Procurement category for non-item (expense) invoice lines",
      },
      {
        name: "LineAmount",
        type: "Decimal",
        note: "Net line amount (qty x price minus discounts) in the invoice currency",
      },
      {
        name: "PurchPrice",
        type: "Decimal",
        note: "Unit purchase price from the PO or entered manually",
      },
      {
        name: "ReceiveNow",
        type: "Decimal",
        note: "Quantity being invoiced in purchase units (the 'update now' quantity)",
      },
      {
        name: "InventTransId",
        type: "String",
        fkTarget: "InventTransOrigin.InventTransId",
        note: "Inventory transaction ID linking to the physical receipt for item-based lines",
      },
      {
        name: "PurchLineRecId",
        type: "Int64",
        fkTarget: "PurchLine.RecId",
        note: "FK to the purchase order line being invoiced",
      },
      {
        name: "DefaultDimension",
        type: "Int64",
        fkTarget: "DimensionAttributeValueSet.RecId",
        note: "Default financial dimensions for this invoice line",
      },
    ],
  },

  VendInvoiceTrans: {
    name: "VendInvoiceTrans",
    description: "Posted vendor invoice lines. One record per invoice line; holds the quantity, price, and tax group posted, cross-referenced to the originating PO line.",
    module: "Accounts Payable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountspayable/transaction/vendinvoicetrans",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "InvoiceId", type: "String", fkTarget: "VendInvoiceJour.InvoiceId", note: "Invoice number; combined with VendAccount identifies the journal header" },
      { name: "PurchID", type: "String", fkTarget: "PurchTable.PurchId", note: "Purchase order number the invoice line originates from (capital ID in AOT). Declared header FK; the PO-line match is the field pair below, not a schema FK." },
      { name: "LineNum", type: "Real", note: "EDT LineNum — a decimal line sequence on the invoice line, not the PO line number. Do not join this to PurchLine.LineNumber" },
      { name: "PurchaseLineLineNumber", type: "Int64", note: "EDT TradeLineNumber — the PO line number. Pair with PurchID to match PurchLine.LineNumber; field match, not a declared FK" },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Product invoiced on this line" },
      { name: "Qty", type: "Decimal", note: "Invoiced quantity" },
      { name: "LineAmountMST", type: "Decimal", note: "Net line amount in accounting currency" },
      { name: "TaxGroup", type: "String", fkTarget: "TaxGroupHeading.TaxGroup", note: "Sales-tax group applied on this invoice line" },
    ],
  },

  VendTrans: {
    name: "VendTrans",
    description: "Vendor accounts-payable subledger transaction. Every posted AP event (invoice, payment, credit note, adjustment) creates a record here. Whether an item is still payable is not stored on this table: the open amount and due date live on VendTransOpen, and this table carries Closed (a settlement date), not an Open flag.",
    module: "Accounts Payable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountspayable/transaction/vendtrans",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key; referenced by VendSettlement and VendInvoiceJour" },
      { name: "AccountNum", type: "String", fkTarget: "VendTable.AccountNum", note: "Vendor account; the AP subledger account" },
      { name: "Voucher", type: "String", note: "GL voucher number; links this AP transaction to GeneralJournalEntry" },
      { name: "TransDate", type: "Date", note: "Accounting date of the transaction" },
      { name: "AmountMST", type: "Decimal", note: "Amount in accounting currency; negative = vendor credit (payment)" },
      { name: "AmountCur", type: "Decimal", note: "Amount in transaction currency" },
      { name: "CurrencyCode", type: "String", fkTarget: "Currency.CurrencyCode", note: "Transaction currency of this entry" },
      { name: "Invoice", type: "String", note: "Vendor invoice number stored for reference and matching" },
      { name: "TransType", type: "Int32", note: "Enum: VendorBalance=0, CreditNote=1, Payment=2, etc.; determines debit/credit nature" },
    ],
  },

  VendSettlement: {
    name: "VendSettlement",
    description: "Vendor settlement record. Links one AP debit transaction (invoice) to one AP credit transaction (payment or credit note) with the settled amount; created by the settlement engine.",
    module: "Accounts Payable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/bank/transaction/vendsettlement",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "TransRecId", type: "Int64", fkTarget: "VendTrans.RecId", note: "FK to the invoice (debit) VendTrans record being settled" },
      { name: "OffsetRecid", type: "Int64", fkTarget: "VendTrans.RecId", note: "RecId of the offset (payment) VendTrans transaction." },
      { name: "SettleAmountMST", type: "Decimal", note: "Amount settled in accounting currency for this link" },
      { name: "SettleAmountCur", type: "Decimal", note: "Amount settled in transaction currency" },
      { name: "TransDate", type: "Date", note: "Date on which settlement was applied" },
    ],
  },

  VendTransOpen: {
    name: "VendTransOpen",
    description: "Open-item projection of a vendor transaction. One row per VendTrans that is not fully settled, holding the due date and the amount still open. Vendor aging, payment proposals and settlement all read this table.",
    module: "Accounts Payable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountspayable/transaction/vendtransopen",
    fields: [
      { name: "RefRecId", type: "Int64", fkTarget: "VendTrans.RecId", note: "The VendTrans transaction this open item belongs to (EDT VendTransRefRecId)" },
      { name: "DueDate", type: "Date", note: "Payment due date derived from the vendor terms; aging and payment proposals run off this date" },
      { name: "AmountCur", type: "Real", note: "Amount still open in the transaction currency" },
      { name: "AmountMST", type: "Real", note: "Amount still open in the accounting currency" },
    ],
  },

  PurchTableHistory: {
    name: "PurchTableHistory",
    description: "Versioned snapshot of a purchase order header. Written when purchase order change management is enabled: each confirmed amendment becomes a dated row (ValidFrom/ValidTo) against the same PurchId rather than overwriting the live header.",
    module: "Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/procurementandsourcing/transaction/purchtablehistory",
    fields: [
      { name: "PurchId", type: "String", note: "Purchase order number the history row belongs to (EDT PurchIdBase)" },
      { name: "PurchStatus", type: "Enum", note: "Enum PurchStatus as at this version: None=0, Backorder=1, Received=2, Invoiced=3, Canceled=4" },
      { name: "ValidFrom", type: "UtcDateTime", note: "Start of the version's validity window" },
      { name: "ValidTo", type: "UtcDateTime", note: "End of the version's validity window; the open-ended row is the current version" },
    ],
  },

  PurchLineHistory: {
    name: "PurchLineHistory",
    description: "Versioned snapshot of a purchase order line, written alongside PurchTableHistory under purchase order change management. Keyed by PO id plus line number.",
    module: "Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/procurementandsourcing/transaction/purchlinehistory",
    fields: [
      { name: "PurchId", type: "String", note: "Purchase order number (EDT PurchIdBase)" },
      { name: "LineNumber", type: "Int64", note: "PO line number; EDT TradeLineNumber, same domain as PurchLine.LineNumber" },
      { name: "ItemId", type: "String", note: "Item on the line at this version" },
      { name: "PurchQty", type: "Real", note: "Ordered quantity at this version" },
      { name: "PurchPrice", type: "Real", note: "Unit price at this version" },
      { name: "ValidFrom", type: "UtcDateTime", note: "Start of the version's validity window" },
      { name: "ValidTo", type: "UtcDateTime", note: "End of the version's validity window" },
    ],
  },

  PurchReqTableHistory: {
    name: "PurchReqTableHistory",
    description: "Versioned snapshot of a purchase requisition header, written when requisition change management is enabled so each submitted/approved revision is retained.",
    module: "Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/procurementandsourcing/transactionheader/purchreqtablehistory",
    fields: [
      { name: "PurchReqId", type: "String", note: "Requisition number (EDT PurchReqId)" },
      { name: "PurchReqTable", type: "Int64", fkTarget: "PurchReqTable.RecId", note: "RecId of the live requisition header this version belongs to (EDT RefRecId)" },
      { name: "Status", type: "Enum", note: "Requisition status at this version; enum PurchReqRequisitionStatus" },
      { name: "ValidFrom", type: "UtcDateTime", note: "Start of the version's validity window" },
      { name: "ValidTo", type: "UtcDateTime", note: "End of the version's validity window" },
    ],
  },

  VendItemMatchingPolicy: {
    name: "VendItemMatchingPolicy",
    description: "Vendor/item invoice-matching policy exception. Overrides the invoice-matching policy from Accounts payable parameters for a specific vendor and item combination.",
    module: "Accounts Payable",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/finance/accountspayable/main/venditemmatchingpolicy",
    fields: [
      { name: "VendAccount", type: "String", fkTarget: "VendTable.AccountNum", note: "Vendor the exception applies to" },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Item the exception applies to" },
      { name: "MatchingPolicy", type: "Enum", note: "Enum PurchMatchingPolicyOption: no matching, two-way (PO/invoice), or three-way (PO/receipt/invoice)" },
    ],
  },

  VendInvoiceMatching: {
    name: "VendInvoiceMatching",
    description: "Invoice-matching header for a pending vendor invoice. Holds the expected PO totals and document-level tolerances the invoice is compared against during matching.",
    module: "Accounts Payable",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/finance/accountspayable/transaction/vendinvoicematching",
    fields: [
      { name: "ParmId", type: "String", note: "Posting session key linking the match to its VendInvoiceInfoTable header" },
      { name: "TableRefId", type: "String", note: "Table reference id scoping the match (EDT TradeLineRefId)" },
      { name: "TotalPriceTolerancePercentage", type: "Real", note: "Allowed percentage variance on the matched total before the variance is flagged" },
      { name: "ExpectedBalance", type: "Real", note: "Expected invoice balance derived from the matched PO/receipt lines" },
    ],
  },

  VendParameters: {
    name: "VendParameters",
    description: "Accounts payable module parameters (one row per legal entity). Carries the default invoice-matching policy, whether matching is enabled, and the document-level price tolerance.",
    module: "Accounts Payable",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/finance/accountspayable/parameter/vendparameters",
    fields: [
      { name: "MatchingPolicy", type: "Enum", note: "Default enum PurchMatchingPolicyOption for the legal entity; vendor/item exceptions in VendItemMatchingPolicy override it" },
      { name: "UseInvoiceMatching", type: "Enum", note: "Enum UnknownNoYes — whether invoice matching is enabled at all" },
      { name: "PolicyViolationAction", type: "Enum", note: "Enum InvoicePolicyViolationStatus — whether a matching-policy violation warns or blocks posting" },
      { name: "TotalPriceTolerancePercentage", type: "Real", note: "Default allowed percentage variance on the invoice total" },
    ],
  },

  CustTransOpen: {
    name: "CustTransOpen",
    description: "Open-item projection of a customer transaction. One row per CustTrans that is not fully settled, holding the due date, the amount still open and the cash-discount / collection state. Overdue AR is read from here, not from CustTrans.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountsreceivable/transaction/custtransopen",
    fields: [
      {
        name: "RefRecId",
        type: "Int64",
        fkTarget: "CustTrans.RecId",
        note: "The CustTrans transaction this open item belongs to.",
      },
      {
        name: "AccountNum",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Customer account, denormalised from the referenced CustTrans.",
      },
      {
        name: "DueDate",
        type: "Date",
        note: "Payment due date derived from the payment terms; aging and collection letters run off this date.",
      },
      {
        name: "AmountCur",
        type: "Real",
        note: "Amount still open on the transaction in the transaction currency.",
      },
      {
        name: "CashDiscDate",
        type: "Date",
        note: "Last date the cash discount can still be taken.",
      },
      {
        name: "CollectionLetter",
        type: "Enum",
        note: "Collection letter state for this open item.",
      },
    ],
  },

  SpecTrans: {
    name: "SpecTrans",
    description: "Polymorphic settlement/selection record. It links a journal line or payment proposal line to the transaction it marks for settlement, using a table-id + record-id pair on each side. Never read SpecRecId on its own — it only identifies a row together with SpecTableId and the company.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/bank/worksheetline/spectrans",
    fields: [
      {
        name: "SpecRecId",
        type: "Int64",
        note: "Record id of the transaction being marked (invoice or payment). Polymorphic — pair with SpecTableId.",
      },
      {
        name: "SpecTableId",
        type: "Int32",
        note: "Table id of the table SpecRecId points into (e.g. CustTrans, CustInvoiceTable). Required discriminator.",
      },
      {
        name: "SpecCompany",
        type: "String",
        note: "Legal entity of the marked transaction; the id pair is only unique within a company.",
      },
      {
        name: "RefRecId",
        type: "Int64",
        note: "Record id of the referencing row (journal line, settlement). Polymorphic — pair with RefTableId.",
      },
      {
        name: "RefTableId",
        type: "Int32",
        note: "Table id of the table RefRecId points into. Required discriminator.",
      },
      {
        name: "RefCompany",
        type: "String",
        note: "Legal entity of the referencing row.",
      },
      {
        name: "Balance01",
        type: "Real",
        note: "Open balance carried on the marked transaction at selection time.",
      },
    ],
  },

  SalesAgreementHeader: {
    name: "SalesAgreementHeader",
    description: "Sales-specific extension of the generic AgreementHeader. A sales agreement is an AgreementHeader row with the sales classification; this table carries the customer and the agreement number that the generic header does not.",
    module: "Sales",
    // No docsUrl: the CDM TOC lists a SalesAgreementHeader table page but it 404s (checked
    // 2026-11-16). Only SalesAgreementHeaderDefault / ...History exist, which are different
    // tables. Left unlinked rather than pointing at the wrong page.
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Shares the AgreementHeader RecId — the agreement identity is the generic header's key.",
      },
      {
        name: "CustAccount",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Customer the agreement is signed with.",
      },
      {
        name: "CustomerDataAreaId",
        type: "String",
        note: "Legal entity of the customer account; a company cross-reference, not a foreign key to a customer row.",
      },
      {
        name: "SalesNumberSequence",
        type: "String",
        note: "Sales agreement number shown to the user.",
      },
      {
        name: "SellingLegalEntity",
        type: "Int64",
        note: "Legal entity that sells under the agreement.",
      },
    ],
  },

  CustInterestJour: {
    name: "CustInterestJour",
    description: "Posted interest note against an overdue customer balance. Created by the interest calculation run; the interest code in CustInterest supplies the rate and the posting profile.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountsreceivable/transaction/custinterestjour",
    fields: [
      {
        name: "AccountNum",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Customer the interest is charged to.",
      },
      {
        name: "InterestNote",
        type: "String",
        note: "Interest note identifier printed on the note sent to the customer.",
      },
      {
        name: "Fee",
        type: "Real",
        note: "Interest amount charged for the period.",
      },
      {
        name: "DueDate",
        type: "Date",
        note: "Due date of the transaction the interest was calculated on.",
      },
      {
        name: "PaymTermId",
        type: "String",
        fkTarget: "PaymTerm.PaymTermId",
        note: "Payment terms the due date was derived from.",
      },
      {
        name: "Status",
        type: "Enum",
        note: "Note status — created, printed, canceled.",
      },
    ],
  },

  CustCollectionLetterJour: {
    name: "CustCollectionLetterJour",
    description: "Posted collection letter for a customer with overdue items. One row per customer per letter code in a collection letter run; the sequence of letter codes is what makes it a dunning ladder.",
    module: "Accounts Receivable",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/accountsreceivable/transaction/custcollectionletterjour",
    fields: [
      {
        name: "AccountNum",
        type: "String",
        fkTarget: "CustTable.AccountNum",
        note: "Customer the letter is sent to.",
      },
      {
        name: "CollectionLetterCode",
        type: "Enum",
        note: "Which step of the collection letter sequence this letter is; the sequence is configured per customer posting profile.",
      },
      {
        name: "CollectionLetterNum",
        type: "String",
        note: "Letter number from the number sequence, printed on the letter.",
      },
      {
        name: "CollectionLetterDate",
        type: "Date",
        note: "Date the letter was posted/printed.",
      },
      {
        name: "DueDate",
        type: "Date",
        note: "Due date of the overdue items the letter covers.",
      },
      {
        name: "Fee",
        type: "Real",
        note: "Fee charged for sending the letter, if the code defines one.",
      },
      {
        name: "Status",
        type: "Enum",
        note: "Letter status — created, printed, canceled.",
      },
    ],
  },

  ReturnReasonCode: {
    name: "ReturnReasonCode",
    description: "Reason code master for return orders. Grouped by ReturnReasonCodeGroupId so return reporting and disposition rules can be driven per reason.",
    module: "Sales",
    // No docsUrl: Microsoft Learn's Common Data Model TOC lists a ReturnReasonCode table page,
    // but the URL 404s (checked 2026-11-16). Only the adjacent ReturnReasonCodeGroup table is
    // published, and that is a different table - linking it would misdescribe this one.
    fields: [
      {
        name: "ReasonCodeId",
        type: "String",
        note: "Reason code identifier referenced by SalesTable.ReturnReasonCodeId on a return order.",
      },
      {
        name: "ReasonCodeGroupId",
        type: "String",
        note: "Group the reason code belongs to, used to bucket return reasons in reporting.",
      },
      {
        name: "Description",
        type: "String",
        note: "User-facing description of the return reason.",
      },
    ],
  },

  InventTransOrigin: {
    name: "InventTransOrigin",
    description: "Identity record for an inventory transaction id. Every InventTrans row for the same business transaction (receipt, issue, settlement) shares one InventTransOrigin; document lines such as WHSWorkLine and CustPackingSlipTrans point at it by InventTransId rather than at InventTrans directly.",
    module: "Inventory",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/transaction/inventtransorigin",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key; InventTrans.InventTransOrigin references this.",
      },
      {
        name: "InventTransId",
        type: "String",
        note: "Inventory transaction id shared by all InventTrans rows of the same business transaction. Document lines carry this id.",
      },
      {
        name: "ItemId",
        type: "String",
        fkTarget: "InventTable.ItemId",
        note: "Item the transaction is for.",
      },
      {
        name: "ItemInventDimId",
        type: "String",
        fkTarget: "InventDim.inventDimId",
        note: "Inventory dimension combination of the transaction.",
      },
      {
        name: "ReferenceCategory",
        type: "Enum",
        note: "Which kind of source document created the transaction (sales order, purchase order, transfer, ...).",
      },
      {
        name: "ReferenceId",
        type: "String",
        note: "Source document number — the sales id, purchase id or transfer id the transaction came from.",
      },
    ],
  },

  WMSPickingRoute: {
    name: "WMSPickingRoute",
    description: "Picking route header in warehouse management — a grouped set of picking work released to the warehouse floor for one shipment or wave.",
    module: "Inventory",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/worksheetheader/wmspickingroute",
    fields: [
      {
        name: "pickingRouteID",
        type: "String",
        note: "Picking route identifier.",
      },
      {
        name: "shipmentId",
        type: "String",
        fkTarget: "WHSShipmentTable.ShipmentId",
        note: "Shipment the route picks for.",
      },
      {
        name: "transRefId",
        type: "String",
        note: "Source document number the picking is fulfilling (sales id or transfer id).",
      },
      {
        name: "transType",
        type: "Enum",
        note: "Type of the source transaction — sales order, transfer issue, and so on.",
      },
      {
        name: "expeditionStatus",
        type: "Enum",
        note: "Route status: open, in process, closed, canceled.",
      },
      {
        name: "DlvDate",
        type: "Date",
        note: "Requested delivery date for the route.",
      },
    ],
  },

  GeneralJournalEntry: {
    name: "GeneralJournalEntry",
    description: "Posted GL voucher header table. Every financial posting (AP invoice, AR payment, journal entry, etc.) creates exactly one row here. It replaced the legacy AX 2009 LedgerTrans table, together with GeneralJournalAccountEntry for the debit/credit lines; there is no Voucher field on this table — the voucher number lives on SubledgerVoucher and on the subledger bridge table.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/ledger/transactionheader/generaljournalentry",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "AccountingDate",
        type: "Date",
        note: "Date on which the entry is recognised in the GL",
      },
      {
        name: "JournalNumber",
        type: "String",
        note: "Subledger journal number (internal posting reference)",
      },
      {
        name: "JournalCategory",
        type: "Int32",
        note: "Enum classifying the journal type (daily, payment, etc.)",
      },
      {
        name: "PostingLayer",
        type: "Int32",
        note: "Enum: Current=0, Operations=1, Tax=2; separates reporting layers",
      },
      {
        name: "Ledger",
        type: "Int64",
        fkTarget: "Ledger.RecId",
        note: "FK to the Ledger table identifying which ledger this entry posts to",
      },
      {
        name: "SubledgerVoucher",
        type: "String",
        note: "Voucher number originating from the subledger posting (e.g. AP invoice voucher)",
      },
      {
        name: "DocumentNumber",
        type: "String",
        note: "External document reference number from the source document",
      },
      {
        name: "DocumentDate",
        type: "Date",
        note: "Date on the source document (may differ from AccountingDate)",
      },
      {
        name: "FiscalCalendarPeriod",
        type: "Int64",
        fkTarget: "FiscalCalendarPeriod.RecId",
        note: "FK to the fiscal calendar period in which this entry is posted",
      },
    ],
  },

  GeneralJournalAccountEntry: {
    name: "GeneralJournalAccountEntry",
    description: "Individual debit or credit line on a posted GL voucher. Each GeneralJournalEntry header has one or more GeneralJournalAccountEntry rows holding the account, amount, posting type, and currency details.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/ledger/transactionline/generaljournalaccountentry",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "GeneralJournalEntry",
        type: "Int64",
        fkTarget: "GeneralJournalEntry.RecId",
        note: "FK to the voucher header this line belongs to",
      },
      {
        name: "LedgerDimension",
        type: "Int64",
        fkTarget: "DimensionAttributeValueCombination.RecId",
        note: "FK to the resolved account + financial dimensions combination",
      },
      {
        name: "AccountingCurrencyAmount",
        type: "Decimal",
        note: "Amount in the accounting (home) currency of the ledger",
      },
      {
        name: "TransactionCurrencyAmount",
        type: "Decimal",
        note: "Amount in the original transaction currency",
      },
      {
        name: "ReportingCurrencyAmount",
        type: "Decimal",
        note: "Amount in the reporting currency of the ledger",
      },
      {
        name: "PostingType",
        type: "Int32",
        note: "Enum indicating the posting type (Ledger, Vendor, Customer, Bank, etc.)",
      },
      {
        name: "IsCredit",
        type: "Int32",
        note: "1 if this line is a credit entry; 0 if a debit entry",
      },
      {
        name: "TransactionCurrencyCode",
        type: "String",
        note: "ISO 4217 currency code of the transaction currency",
      },
      {
        name: "MainAccount",
        type: "Int64",
        fkTarget: "MainAccount.RecId",
        note: "FK to the MainAccount record (denormalised from LedgerDimension for quick lookup)",
      },
    ],
  },

  DimensionAttributeValueCombination: {
    name: "DimensionAttributeValueCombination",
    description: "Stores one resolved set of financial dimension values (e.g. MainAccount=1001, Department=10, CostCenter=CC01). Many transaction tables store a LedgerDimension field (Int64) that is an FK to this table's RecId, which is how financial dimensions are attached to ledger entries.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/financialdimensions/main/dimensionattributevaluecombination",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key; referenced by LedgerDimension FK fields across the system",
      },
      {
        name: "DisplayValue",
        type: "String",
        note: "Concatenated display string of all dimension values (e.g. '1001-DEPT10-CC01')",
      },
      {
        name: "AccountStructure",
        type: "Int64",
        fkTarget: "DimensionHierarchy.RecId",
        note: "FK to the account structure (DimensionHierarchy) defining which dimensions apply",
      },
      {
        name: "LedgerDimensionType",
        type: "Int32",
        note: "Enum distinguishing the combination type (full ledger account, default dimension, etc.)",
      },
      {
        name: "DataAreaForCreation",
        type: "String",
         note: "Legal entity identifier in which this dimension combination was first created",
      },
    ],
  },

  DimensionHierarchy: {
    name: "DimensionHierarchy",
    description: "Account structure (dimension hierarchy) definition — specifies the main account and financial dimension segments allowed for a ledger, including their ordering, wildcard rules, and whether a segment is required. Used as the account structure FK in DimensionAttributeValueCombination. Each ledger chart of accounts has one or more active account structures.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/configure-account-structures",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key; referenced by DimensionAttributeValueCombination.AccountStructure" },
      { name: "Name", type: "String", note: "Display name of the account structure (e.g. 'Balance sheet', 'P&L')" },
      { name: "StructureType", type: "Enum", note: "0=AccountStructure (main account + dimensions), 1=AdvancedRule (supplemental dimensions)" },
      { name: "IsDraft", type: "Enum", note: "True while the hierarchy is a draft; active hierarchies have IsDraft = No." },
      { name: "Description", type: "String", note: "Optional description of the hierarchy" },
    ],
  },

  // ── RTR tables ──────────────────────────────
  MainAccount: {
    name: "MainAccount",
    description: "Individual general ledger account within a chart of accounts. Defines account type, posting behavior, FX revaluation settings, and closing options.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/finance/financialdimensions/main/mainaccount",
    fields: [
      { name: "RecId", type: "int64", note: "Primary key (surrogate)" },
      { name: "MainAccountId", type: "string", note: "Natural key — account number (unique within a chart of accounts)" },
      { name: "Name", type: "string", note: "Display name of the account" },
      { name: "Type", type: "int32 (enum)", note: "Main account type: BalanceSheet, ProfitAndLoss, Total, Reporting, None" },
      { name: "LedgerChartOfAccounts", type: "int64 (FK → LedgerChartOfAccounts.RecId)", note: "The chart of accounts this account belongs to" },
      { name: "ExchangeAdjustmentRateType", type: "int64 (FK → ExchangeRateType.RecId, nullable)", note: "Exchange rate type used for foreign-currency revaluation" },
      { name: "FinancialReportingExchangeRateType", type: "int64 (FK → ExchangeRateType.RecId, nullable)", note: "Exchange rate type used for financial-reporting currency translation" },
    ],
  },

  LedgerChartOfAccounts: {
    name: "LedgerChartOfAccounts",
    description: "Chart of accounts header. A named, shared collection of main accounts that can be assigned to one or more legal-entity ledgers.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/finance/ledger/main/ledgerchartofaccounts",
    fields: [
      { name: "RecId", type: "int64", note: "Primary key (surrogate)" },
      { name: "Name", type: "string", note: "Chart-of-accounts identifier / display name (displayName: 'Chart of accounts')" },
      { name: "Description", type: "string (nullable)", note: "Human-readable description" },
      { name: "MainAccountFormatMask", type: "string (nullable)", note: "Account-number display format mask (e.g., '######')" },
    ],
  },

  CompanyInfo: {
    name: "CompanyInfo",
    description: "Legal entity master record — one row per company in a D365FO deployment. Holds the company name, DataAreaId (company account), primary postal address, VAT registration number, and contact details. Referenced by Ledger and all transaction tables via DataAreaId.",
    module: "Organization Administration",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/ledger/main/companyinfo",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "DataArea",
        type: "String",
        note: "Primary identifier (company account / DataAreaId) for this legal entity",
      },
      {
        name: "Name",
        type: "String",
        note: "Legal entity display name",
      },
      {
        name: "NameAlias",
        type: "String",
        note: "Short alias for the company",
      },
      {
        name: "PartyNumber",
        type: "String",
        note: "Global address book party number for this legal entity",
      },
      {
        name: "VATNum",
        type: "String",
        note: "VAT registration number for this legal entity",
      },
      {
        name: "LanguageId",
        type: "String",
        note: "Default language code for the company (e.g. 'en-us')",
      },
      {
        name: "PrimaryAddressLocation",
        type: "Int64",
        fkTarget: "LogisticsLocation.RecId",
        note: "FK to the primary postal address record",
      },
      {
        name: "BranchId",
        type: "String",
        note: "Business segment / branch identifier for reporting",
      },
      {
        name: "OrgId",
        type: "String",
        note: "Organization ID used in inter-company scenarios",
      },
    ],
  },

  OMOperatingUnit: {
    name: "OMOperatingUnit",
    description: "Operating unit (business unit, department, cost centre, retail channel) master. Acts as the dimension value source for organisational financial dimensions. OMOperatingUnitType enum distinguishes the unit type: BusinessUnit, Department, CostCenter, RetailChannel, Warehouse.",
    module: "Organization Administration",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/common/gab/main/omoperatingunit",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "OMOperatingUnitNumber",
        type: "String",
        note: "User-visible code for this operating unit (appears in dimension value lookups)",
      },
      {
        name: "Name",
        type: "String",
        note: "Display name of the operating unit",
      },
      {
        name: "OMOperatingUnitType",
        type: "Int32",
        note: "Enum: 1 = BusinessUnit, 2 = Department, 3 = CostCenter, 4 = RetailChannel, 5 = Warehouse — determines which financial dimension this unit belongs to",
      },
      {
        name: "PartyNumber",
        type: "String",
        note: "Global address book party number for this org unit",
      },
      {
        name: "NameAlias",
        type: "String",
        note: "Short alias for the operating unit",
      },
      {
        name: "PrimaryAddressLocation",
        type: "Int64",
        fkTarget: "LogisticsLocation.RecId",
        note: "FK to the primary postal address for this unit",
      },
      {
        name: "HcmWorker",
        type: "Int64",
        fkTarget: "HcmWorker.RecId",
        note: "FK to the manager (HCM Worker) responsible for this operating unit",
      },
    ],
  },

  Ledger: {
    name: "Ledger",
    description: "Legal-entity ledger configuration. Binds a legal entity to its chart of accounts, fiscal calendar, accounting/reporting currencies, and default exchange rate type. One Ledger record per legal entity.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/finance/ledger/main/ledger",
    fields: [
      { name: "RecId", type: "int64", note: "Primary key (surrogate)" },
      { name: "ChartOfAccounts", type: "int64 (FK → LedgerChartOfAccounts.RecId)", note: "Chart of accounts used by this legal entity (displayName: 'Chart of accounts')" },
      { name: "FiscalCalendar", type: "int64 (FK → FiscalCalendar.RecId)", note: "Fiscal calendar governing the ledger periods" },
      { name: "DefaultExchangeRateType", type: "int64 (FK → ExchangeRateType.RecId, nullable)", note: "Default exchange rate type for transaction currency conversion (displayName: 'Default exchange rate type')" },
      { name: "AccountingCurrency", type: "string", note: "ISO 4217 code for the accounting (home/functional) currency" },
      { name: "ReportingCurrency", type: "string (nullable)", note: "ISO 4217 code for the optional second reporting currency" },
      { name: "Description", type: "string (nullable)", note: "Ledger description" },
    ],
  },

  FiscalCalendar: {
    name: "FiscalCalendar",
    description: "Fiscal calendar definition. Container for one or more fiscal years, each subdivided into periods. Shared across legal entities and also used for fixed-asset books and budget cycles.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/finance/ledger/reference/fiscalcalendar",
    fields: [
      { name: "RecId", type: "int64", note: "Primary key (surrogate)" },
      { name: "CalendarId", type: "string", note: "Natural key — unique calendar identifier (e.g., 'Fiscal_2024')" },
      { name: "Description", type: "string", note: "Human-readable description of the calendar" },
    ],
  },

  FiscalCalendarPeriod: {
    name: "FiscalCalendarPeriod",
    description: "Individual accounting period within a fiscal year. Defines start/end dates, period type (operating vs. closing), and month/quarter metadata.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/finance/ledger/reference/fiscalcalendarperiod",
    fields: [
      { name: "RecId", type: "int64", note: "Primary key (surrogate)" },
      { name: "Name", type: "string", note: "Period name (e.g., 'Jan 2024')" },
      { name: "ShortName", type: "string (nullable)", note: "Abbreviated period label" },
      { name: "StartDate", type: "date", note: "First day of the period" },
      { name: "EndDate", type: "date", note: "Last day of the period" },
      { name: "Type", type: "int32 (enum, nullable)", note: "Period type: 0=Operating, 1=Opening, 2=Closing (closing periods used for year-end entries)" },
      { name: "FiscalCalendar", type: "int64 (FK → FiscalCalendar.RecId, nullable)", note: "Parent fiscal calendar" },
      { name: "FiscalCalendarYear", type: "int64 (FK → FiscalCalendarYear.RecId)", note: "Parent fiscal year record" },
      { name: "Month", type: "int32 (nullable)", note: "Calendar month number (1–12)" },
      { name: "Quarter", type: "int32 (nullable)", note: "Calendar quarter number (1–4)" },
    ],
  },

  LedgerCalendar: {
    name: "LedgerCalendar",
    description: "Fiscal calendar definition shared across legal entities and used for ledgers, fixed assets, and budget cycles. The D365FO table is FiscalCalendar.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/dynamics365/finance/budgeting/fiscal-calendars-fiscal-years-periods",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "Ledger", type: "Int64", fkTarget: "Ledger.RecId", note: "FK to the ledger (legal entity) this calendar assignment applies to" },
      { name: "FiscalCalendar", type: "Int64", fkTarget: "FiscalCalendar.RecId", note: "FK to the fiscal calendar used by this ledger" },
      { name: "AllowTransactionsInOpenPeriods", type: "Enum", note: "Controls whether transactions are allowed in open periods (0=Yes, 1=No — requires explicit period opening)" },
    ],
  },

  LedgerAllocationRule: {
    name: "LedgerAllocationRule",
    description: "Allocation rule for automatically distributing ledger balances or fixed amounts to destination accounts. Supports four methods: Basis (proportional to a ledger balance), Fixed Percentage, Fixed Weight, and Equally.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/finance/ledger/main/ledgerallocationrule",
    fields: [
      { name: "RecId", type: "int64", note: "Primary key (surrogate)" },
      { name: "RuleId", type: "string", note: "Natural key — unique allocation rule identifier" },
      { name: "AllocationDescription", type: "String", note: "Description of the allocation rule." },
      { name: "AllocationMethod", type: "int32 (enum)", note: "0=Basis, 1=Fixed percentage, 2=Fixed weight, 3=Equally" },
      { name: "DataSource", type: "int32 (enum)", note: "Source of amounts to allocate: 0=Ledger balance, 1=Fixed value" },
      { name: "AllocationActive", type: "Enum", note: "Whether the allocation rule is active." },
    ],
  },

  SubledgerVoucherGeneralJournalEntry: {
    name: "SubledgerVoucherGeneralJournalEntry",
    description: "Bridge table linking a subledger-module voucher (e.g., AP invoice, AR payment, bank transaction) to its corresponding GeneralJournalEntry in the GL. Provides traceability from subledger to posted ledger.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/finance/ledger/transaction/subledgervouchergeneraljournalentry",
    fields: [
      { name: "RecId", type: "int64", note: "Primary key (surrogate)" },
      { name: "GeneralJournalEntry", type: "Int64", note: "The GL general journal entry header this voucher maps to" },
      { name: "Voucher", type: "string", note: "Subledger voucher number (from AP/AR/Bank/etc.)" },
      { name: "VoucherDataAreaId", type: "string", note: "Legal entity (DataAreaId) of the originating subledger voucher" },
      { name: "AccountingDate", type: "Date", note: "Accounting date of the subledger voucher" },
    ],
  },

  ExchangeRate: {
    name: "ExchangeRate",
    description: "Currency exchange rate record. Stores a rate value for a currency pair (from/to) effective from a specific date. The rate is indirectly associated with an ExchangeRateType via the ExchangeRateCurrencyPair parent.",
    module: "System / Currency",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/common/currency/reference/exchangerate",
    fields: [
      { name: "RecId", type: "int64", note: "Primary key (surrogate)" },
      { name: "ExchangeRate", type: "decimal", note: "The exchange rate value (e.g., units of 'to' currency per unit of 'from' currency)" },
      { name: "ExchangeRateCurrencyPair", type: "int64 (FK → ExchangeRateCurrencyPair.RecId, nullable)", note: "Currency pair this rate applies to; ExchangeRateCurrencyPair in turn FK→ExchangeRateType" },
      { name: "ValidFrom", type: "date (nullable)", note: "Effective start date of the rate (displayName: 'Start date')" },
      { name: "ValidTo", type: "date (nullable, isReadOnly)", note: "Calculated end date (set to the ValidFrom of the next rate minus 1 day)" },
    ],
  },

  ExchangeRateType: {
    name: "ExchangeRateType",
    description: "Exchange rate type definition (e.g., Default, Average, Spot, Budget). Each type groups a set of ExchangeRateCurrencyPair/ExchangeRate records for a specific financial purpose (transaction entry, revaluation, reporting translation).",
    module: "System / Currency",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/common/currency/group/exchangeratetype",
    fields: [
      { name: "RecId", type: "int64", note: "Primary key (surrogate)" },
      { name: "Name", type: "string", note: "System identifier for the rate type (e.g., 'Default', 'Average')" },
      { name: "Description", type: "string (nullable)", note: "Display label for the rate type (CDM displayName: 'Name')" },
      { name: "CalendarId", type: "string (nullable)", note: "Optional work calendar used for weighted-average rate calculation" },
    ],
  },

  Currency: {
    name: "Currency",
    description: "Currency master — one row per ISO 4217 currency code supported in the system. Defines the symbol, decimal precision, and rounding unit for amounts displayed and stored in that currency. Referenced by transaction tables via CurrencyCode.",
    module: "System / Currency",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/common/currency/group/currency",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "CurrencyCode", type: "String", note: "Natural primary key — ISO 4217 code (e.g. 'USD', 'EUR', 'GBP')" },
      { name: "Txt", type: "String", note: "Full name of the currency (e.g. 'US dollar')" },
      { name: "Symbol", type: "String", note: "Currency symbol (e.g. '$', '€', '£')" },
      { name: "RoundOffType", type: "Enum", note: "Rounding method: 0=Ordinary, 1=Downward, 2=Upward" },
      { name: "RoundOffFinancial", type: "Decimal", note: "Rounding unit for financial amounts (e.g. 0.01 for cent precision)" },
      { name: "RoundOffSales", type: "Decimal", note: "Rounding unit for sales prices" },
      { name: "RoundOffPurchase", type: "Decimal", note: "Rounding unit for purchase prices" },
    ],
  },

  LedgerConsolidate: {
    name: "LedgerConsolidate",
    description: "Consolidation template - the setup record that defines source legal entities, account mappings, and currency translation for a consolidation run (D365FO template-based consolidation; the AX2012 LedgerConsolidate table no longer exists).",
    module: "General Ledger / Consolidations",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/finance/ledger/transactionheader/ledgerconsolidatehist",
    fields: [
      { name: "Name", type: "String", note: "Consolidation template name." },
      { name: "Description", type: "String", note: "Description of the consolidation template." },
      { name: "FromAccount", type: "String", note: "Source main account range start for account mapping." },
      { name: "ToAccount", type: "String", note: "Source main account range end for account mapping." },
      { name: "ProcessMode", type: "Enum", note: "Process mode for the consolidation run." },
      { name: "ConsolidateAccountSource", type: "Enum", note: "Source of consolidation account mapping (ledger or group)." },
      { name: "UseConsolidateAccount", type: "Enum", note: "Whether consolidation accounts are used for the run." },
      { name: "TransferCurrent", type: "Enum", note: "Whether current-period balances are transferred." },
      { name: "TransferBudget", type: "Enum", note: "Whether budget balances are transferred." },
    ],
  },

  LedgerConsolidateTrans: {
    name: "LedgerConsolidateTrans",
    description: "Consolidation history - one record per executed consolidation run, identifying the source subsidiary, period, and processing details (D365FO LedgerConsolidateHist).",
    module: "General Ledger / Consolidations",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/finance/budgeting/consolidation-elimination-overview",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key." },
      { name: "CompanyIdOrigin", type: "String", fkTarget: "DataArea.Id", note: "Source (subsidiary) legal entity of the consolidation run." },
      { name: "FromDate", type: "Date", note: "Start of the consolidation period." },
      { name: "ToDate", type: "Date", note: "End of the consolidation period." },
      { name: "Description", type: "String", note: "Description of the consolidation run." },
      { name: "Reviewed", type: "Enum", note: "Whether the consolidation result has been reviewed." },
      { name: "Reversed", type: "Enum", note: "Whether the consolidation run has been reversed." },
      { name: "ProcessDateTime", type: "UtcDateTime", note: "Timestamp of the consolidation run." },
      { name: "BatchJobId", type: "Int64", fkTarget: "BatchJob.RecId", note: "Batch job that executed the consolidation run." },
    ],
  },

  LedgerClosingSheet: {
    name: "LedgerClosingSheet",
    description: "Period closing worksheet header. Groups the closing accounts and entries used during period-end close for a specific fiscal period. Lines (LedgerClosingTable) reference individual main accounts.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/finance/ledger/worksheetheader/ledgerclosingsheet",
    fields: [
      { name: "RecId", type: "int64", note: "Primary key (surrogate)" },
      { name: "Sheet", type: "string", note: "Natural key — closing sheet identifier" },
      { name: "Name", type: "string (nullable)", note: "Human-readable closing sheet name" },
      { name: "FiscalCalendarPeriod", type: "int64 (FK → FiscalCalendarPeriod.RecId, nullable)", note: "The fiscal period being closed" },
      { name: "FromDate", type: "date (nullable)", note: "Start of the closing period (displayName: 'From')" },
      { name: "ToDate", type: "date (nullable)", note: "End of the closing period (displayName: 'To')" },
      { name: "PostDate", type: "date (nullable)", note: "Date used to post closing entries (displayName: 'Post')" },
      { name: "Voucher", type: "string (nullable, isReadOnly)", note: "Voucher number of the posted closing transaction" },
      { name: "SumResult", type: "decimal (nullable, isReadOnly)", note: "Computed P&L net result for the sheet (displayName: 'Result')" },
    ],
  },

  LedgerFiscalCalendarPeriod: {
    name: "LedgerFiscalCalendarPeriod",
    description: "Ledger-specific period status record associating a fiscal calendar period with a ledger.",
    module: "General Ledger",
    fields: [
      { name: "FiscalCalendarPeriod", type: "Int64", fkTarget: "FiscalCalendarPeriod.RecId", note: "EDT FiscalCalendarPeriodRecId; fiscal period for this ledger." },
      { name: "Ledger", type: "Int64", fkTarget: "Ledger.RecId", note: "EDT LedgerRecId; legal-entity ledger whose period status this record stores." },
      { name: "Status", type: "Enum", note: "Enum FiscalPeriodStatus; status for this ledger and fiscal period." },
    ],
  },

  // ── INV tables ──────────────────────────────
  EcoResProduct: {
    name: "EcoResProduct",
    description: "Global shared product definition (not yet released to a legal entity). Holds the product number, type (Item/Service), and top-level attributes that are shared across all companies. Released per-company records link back to this table via InventTable.Product.",
    module: "Product Information Management – shared (cross-company)",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/productinformationmanagement/main/ecoresproduct",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK; system-generated" },
      { name: "DisplayProductNumber", type: "string", note: "Human-readable product number shown in UI" },
      { name: "ProductType", type: "int32 enum", note: "1 = Item, 2 = Service" },
      { name: "SearchName", type: "string", note: "Alternate search/alias name; nullable" },
      { name: "ServiceType", type: "int32 enum", note: "Delivered / Work center; nullable" },
      { name: "InstanceRelationType", type: "int64", note: "Polymorphic type discriminator (EcoResDistinctProduct vs EcoResProductMaster); nullable" },
      { name: "PdsCWProduct", type: "int32", note: "Catch-weight product flag; nullable" },
    ],
  },

  EcoResCategory: {
    name: "EcoResCategory",
    description: "Individual category node within a named hierarchy (e.g. Procurement or Sales). Products are assigned to categories via EcoResProductCategory; the tree structure uses ParentCategory and NestedSetLeft/Right.",
    module: "Product Information Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/productinformationmanagement/main/ecorescategory",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "CategoryHierarchy",
        type: "Int64",
        fkTarget: "EcoResCategoryHierarchy.RecId",
        note: "FK to the parent hierarchy this category belongs to",
      },
      {
        name: "Name",
        type: "String",
        note: "Display name of the category node",
      },
      {
        name: "Code",
        type: "String",
        note: "Commodity code (e.g. Intrastat/HS code)",
      },
      {
        name: "ParentCategory",
        type: "Int64",
        fkTarget: "EcoResCategory.RecId",
        note: "Recursive FK to parent category; null for root nodes",
      },
      {
        name: "IsActive",
        type: "Int32",
        note: "Active flag; inactive categories blocked from selection",
      },
      {
        name: "Level",
        type: "Int64",
        note: "Depth level in hierarchy tree (0 = root)",
      },
      {
        name: "NestedSetLeft",
        type: "Int64",
        note: "Nested-set model left boundary for efficient subtree queries",
      },
    ],
  },

  EcoResCategoryHierarchy: {
    name: "EcoResCategoryHierarchy",
    description: "Named category hierarchy (e.g. 'Procurement categories', 'Sales categories'). Multiple hierarchies can coexist; each contains its own tree of EcoResCategory nodes.",
    module: "Product Information Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/productinformationmanagement/main/ecorescategoryhierarchy",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "Name",
        type: "String",
        note: "Display name of the hierarchy (e.g. 'Procurement categories')",
      },
      {
        name: "HierarchyModifier",
        type: "Int32",
        note: "Enum controlling which module roles can use this hierarchy (Sales, Procurement, etc.)",
      },
    ],
  },

  InventItemGroup: {
    name: "InventItemGroup",
    description: "Item group (per legal entity) that drives inventory posting profiles and tax item groups. InventTable.ItemGroupId FK is one of the most common extension join points in D365FO.",
    module: "Inventory",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/group/inventitemgroup",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "ItemGroupId",
        type: "String",
        note: "Primary key — user-visible group code referenced by InventTable.ItemGroupId",
      },
      {
        name: "Name",
        type: "String",
        note: "Description of the item group",
      },
      {
        name: "TaxItemGroupIdSales",
        type: "String",
        fkTarget: "TaxItemGroupHeading.TaxItemGroup",
        note: "Default sales tax item group for items in this group",
      },
      {
        name: "TaxItemGroupIdPurch",
        type: "String",
        fkTarget: "TaxItemGroupHeading.TaxItemGroup",
        note: "Default purchase tax item group for items in this group",
      },
      {
        name: "DataAreaId",
        type: "String",
        note: "Legal entity; InventItemGroup is per-company",
      },
    ],
  },

  InventItemGroupItem: {
    name: "InventItemGroupItem",
    description: "Item-to-item-group assignment, one row per item per legal entity. This is the table that actually carries ItemGroupId in current D365FO — InventTable.ItemGroupId is the legacy column. AOT declares FKs to both InventItemGroup and InventTable, qualified by company.",
    module: "Inventory Management – group assignment (per legal entity)",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/main/inventitemgroupitem",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate PK" },
      { name: "ItemId", type: "String", note: "EDT ItemId; the released product in this legal entity" },
      { name: "ItemDataAreaId", type: "String", note: "EDT DataAreaId; legal entity of the item (qualifier on the InventTable relation)" },
      { name: "ItemGroupId", type: "String", note: "EDT ItemGroupId; FK → InventItemGroup.ItemGroupId" },
      { name: "ItemGroupDataAreaId", type: "String", note: "EDT DataAreaId; legal entity of the item group (qualifier on the InventItemGroup relation)" },
    ],
  },

  InventTableModule: {
    name: "InventTableModule",
    description: "Stores module-specific settings for a released product (InventTable) per module type: Purchase (1), Sales (2), and Inventory (3). Each released product has up to three rows—one per module. Controls default unit, pricing, and discount rules.",
    module: "Product Information Management / Inventory Management – per legal entity",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/productinformationmanagement/main/inventtablemodule",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK" },
      { name: "ItemId", type: "string", note: "FK → InventTable.ItemId; released product in this legal entity" },
      { name: "ModuleType", type: "int32 enum", note: "1 = Purchase, 2 = Sales, 3 = Inventory" },
      { name: "UnitId", type: "string", note: "Default unit of measure for the module; FK → UnitOfMeasure" },
      { name: "PriceUnit", type: "decimal", note: "Quantity basis for the module price (e.g. price per 100 units)" },
      { name: "Price", type: "decimal", note: "Module list/cost price per PriceUnit" },
      { name: "LineDisc", type: "decimal", note: "Default line discount %" },
      { name: "DataAreaId", type: "string", note: "Legal-entity partition; FK → CompanyInfo" },
    ],
  },

  InventModelGroup: {
    name: "InventModelGroup",
    description: "Defines the inventory costing model and physical/financial posting policy for items that belong to the group. Controls whether FIFO, LIFO, Weighted Average, Standard Cost, or Moving Average is used, and whether physical transactions update the ledger.",
    module: "Inventory Management – group (per legal entity)",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/group/inventmodelgroup",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK" },
      { name: "ModelGroupId", type: "string", note: "User-defined group code (e.g. 'FIFO', 'STD')" },
      { name: "Name", type: "string", note: "Descriptive name" },
      { name: "InventModel", type: "int32 enum", note: "Costing method: FIFO=1, LIFO=2, WeightedAvg=3, MovingAvg=4, StdCost=5, LIFO date=6, WeightedAvg date=7" },
      { name: "PostOnhandPhysical", type: "Enum", note: "Post physical on-hand updates to the ledger." },
      { name: "PostOnhandFinancial", type: "Enum", note: "Post financial (invoice) updates to the ledger." },
      { name: "NegativePhysical", type: "Enum", note: "Allow negative physical inventory for items in this group." },
      { name: "StandardCost", type: "Enum", note: "Use standard cost as the costing method for items in this group." },
    ],
  },

  InventModelGroupItem: {
    name: "InventModelGroupItem",
    description: "Item-to-item-model-group assignment, one row per item per legal entity — the table that carries the costing method an item actually resolves to. AOT declares FKs to both InventModelGroup and InventTable, qualified by company.",
    module: "Inventory Management – group assignment (per legal entity)",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/main/inventmodelgroupitem",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate PK" },
      { name: "ItemId", type: "String", note: "EDT ItemId; the released product in this legal entity" },
      { name: "ItemDataAreaId", type: "String", note: "EDT DataAreaId; legal entity of the item (qualifier on the InventTable relation)" },
      { name: "ModelGroupId", type: "String", note: "EDT InventModelGroupId; FK → InventModelGroup.ModelGroupId" },
      { name: "ModelGroupDataAreaId", type: "String", note: "EDT DataAreaId; legal entity of the model group (qualifier on the InventModelGroup relation)" },
    ],
  },

  InventSum: {
    name: "InventSum",
    description: "Aggregated on-hand inventory quantities for each unique combination of ItemId and InventDimId. Updated in real time by inventory transactions. Non-WMS on-hand source of truth; WMS-enabled warehouses supplement this with WHSInventReserve.",
    module: "Inventory Management – transaction (per legal entity)",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/transaction/inventsum",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK" },
      { name: "ItemId", type: "string", note: "FK → InventTable.ItemId" },
      { name: "InventDimId", type: "string", note: "FK → InventDim; dimension combination (site/warehouse/location/batch etc.)" },
      { name: "PhysicalInvent", type: "decimal", note: "Total physically on hand (received minus issued)" },
      { name: "PostedQty", type: "decimal", note: "Financially posted on-hand quantity" },
      { name: "ReservPhysical", type: "decimal", note: "Physically reserved quantity" },
      { name: "ReservOrdered", type: "decimal", note: "Ordered-reserved quantity (future receipt reservation)" },
      { name: "AvailPhysical", type: "decimal", note: "Available physical = PhysicalInvent − ReservPhysical; read-only calculated" },
      { name: "OnOrder", type: "decimal", note: "Quantity on open inbound orders" },
    ],
  },

  WHSInventReserve: {
    name: "WHSInventReserve",
    description: "WMS-level on-hand and reservation record. For WMS-enabled warehouses, one row exists per hierarchy level per dimension combination, enabling the WMS reservation algorithm to evaluate availability at each level (site → warehouse → status → location → license plate).",
    module: "Warehouse Management – transaction (per legal entity)",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/transaction/whsinventreserve",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK" },
      { name: "ItemId", type: "string", note: "FK → InventTable" },
      { name: "InventDimId", type: "string", note: "FK → InventDim; dimension combination at this hierarchy level" },
      { name: "ReservPhysical", type: "decimal", note: "Physically reserved quantity at this level" },
      { name: "ReservOrdered", type: "decimal", note: "Ordered-reserved quantity at this level" },
      { name: "AvailPhysical", type: "decimal", note: "Available physical at this level" },
      { name: "AvailOrdered", type: "decimal", note: "Available ordered at this level" },
      { name: "CWReservPhysical", type: "decimal", note: "Catch-weight physically reserved; nullable" },
      { name: "CWReservOrdered", type: "decimal", note: "Catch-weight ordered reserved; nullable" },
    ],
  },

  WHSReservationHierarchy: {
    name: "WHSReservationHierarchy",
    description: "Defines a named reservation hierarchy that specifies which inventory dimensions are controlled at which level, and which are delegated to WMS work. Shared (cross-company) table. Assigned to items via WHSReservationHierarchyItem. WHSReservationHierarchyElement rows define each dimension level.",
    module: "Warehouse Management – group (shared / cross-company)",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/group/whsreservationhierarchy",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK" },
      { name: "Name", type: "string", note: "Unique hierarchy name (e.g. 'Default', 'Batch-above-loc')" },
      { name: "Description", type: "string", note: "Human-readable description; nullable" },
    ],
  },

  InventTransferTable: {
    name: "InventTransferTable",
    description: "Transfer order header representing a planned or in-transit movement of goods between two warehouses or sites within the same legal entity. Controls dates, from/to locations, and overall status lifecycle (Created → Shipped → Received).",
    module: "Inventory Management – worksheet header (per legal entity)",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/worksheetheader/inventtransfertable",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK" },
      { name: "TransferId", type: "string", note: "Transfer order number; natural key" },
      { name: "InventLocationIdFrom", type: "string", note: "From warehouse; FK → InventLocation" },
      { name: "InventLocationIdTo", type: "string", note: "To warehouse; FK → InventLocation" },
      { name: "ShipDate", type: "date", note: "Planned shipment date" },
      { name: "ReceiveDate", type: "date", note: "Planned receipt date" },
      { name: "TransferStatus", type: "int32 enum", note: "Created=0, Shipped=1, Received=2, None=3" },
    ],
  },

  InventTransferLine: {
    name: "InventTransferLine",
    description: "Transfer order line for a specific item and dimension combination within a transfer order. Tracks ship and receive quantities separately. InventDimId captures the 'from' dimensions; InventDimIdTo captures 'to' dimensions (relevant when tracking dimensions differ between sites).",
    module: "Inventory Management – worksheet line (per legal entity)",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/worksheetline/inventtransferline",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK" },
      { name: "TransferId", type: "string", note: "FK → InventTransferTable.TransferId" },
      { name: "LineNum", type: "decimal", note: "Line sequence number" },
      { name: "ItemId", type: "string", note: "FK → InventTable.ItemId" },
      { name: "InventDimId", type: "string", note: "FK → InventDim; source (from) dimension combination" },
      { name: "QtyTransfer", type: "Decimal", note: "Quantity to transfer." },
      { name: "QtyShipped", type: "decimal", note: "Quantity physically shipped" },
      { name: "QtyReceived", type: "decimal", note: "Quantity received at destination" },
    ],
  },

  InventJournalTable: {
    name: "InventJournalTable",
    description: "Inventory journal header for non-WMS inventory adjustments: Movement, Counting, Profit/Loss, BOM, Transfer, and Tag counting journal types. One row per journal batch. Lines stored in InventJournalTrans. Posted journals create InventTrans records.",
    module: "Inventory Management – worksheet header (per legal entity)",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/worksheetheader/inventjournaltable",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK" },
      { name: "JournalId", type: "string", note: "Journal number; natural key" },
      { name: "JournalType", type: "int32 enum", note: "1=Movement, 2=Counting, 3=P&L, 4=Adjustment, 5=Transfer, 6=BOM" },
      { name: "JournalNameId", type: "string", note: "FK → InventJournalName; determines GL setup" },
      { name: "Posted", type: "int32", note: "1 = Journal has been posted" },
      { name: "Description", type: "string", note: "Free-text description; nullable" },
      { name: "DataAreaId", type: "string", note: "Legal-entity partition" },
    ],
  },

  InventJournalTrans: {
    name: "InventJournalTrans",
    description: "Inventory journal transaction lines. One row per item/dimension/date combination within a journal. For counting journals the CountedQty vs. on-hand difference is posted as an adjustment. Creates InventTrans on posting.",
    module: "Inventory Management – worksheet line (per legal entity)",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/worksheetline/inventjournaltrans",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK" },
      { name: "JournalId", type: "string", note: "FK → InventJournalTable.JournalId" },
      { name: "LineNum", type: "decimal", note: "Line sequence number" },
      { name: "TransDate", type: "date", note: "Transaction date" },
      { name: "ItemId", type: "string", note: "FK → InventTable.ItemId" },
      { name: "InventDimId", type: "string", note: "FK → InventDim" },
      { name: "Qty", type: "decimal", note: "Adjustment quantity (positive = in, negative = out)" },
      { name: "Counted", type: "Decimal", note: "Counted quantity for counting journal lines (expected vs counted difference is posted)." },
      { name: "CostAmount", type: "decimal", note: "Cost value of the adjustment" },
      { name: "Voucher", type: "string", note: "GL voucher number (populated on post)" },
    ],
  },

  WHSCountingJournalTable: {
    name: "WHSCountingJournalTable",
    description: "Cycle count plan header - creates count work for items/locations according to thresholds and plan lines. Count results are registered and posted through counting journals (InventJournalTable/InventJournalTrans).",
    module: "Warehouse Management – worksheet header (per legal entity)",
    docsUrl: "https://learn.microsoft.com/dynamics365/supply-chain/warehousing/cycle-counting",
    fields: [
      { name: "CycleCountPlanId", type: "String", note: "Cycle count plan identifier; the plan generates count work." },
      { name: "Description", type: "String", note: "Description of the cycle count plan." },
      { name: "DaysBetween", type: "Int", note: "Number of days between counts for items covered by the plan." },
      { name: "MaxCounts", type: "Int", note: "Maximum number of counts for an item per cycle." },
      { name: "WorkPoolId", type: "String", fkTarget: "WHSWorkPool.WorkPoolId", note: "Work pool for the generated count work." },
      { name: "WorkTemplateCode", type: "String", fkTarget: "WHSWorkTemplateTable.WorkTemplateCode", note: "Work template used to generate count work." },
    ],
  },

  WHSCountingJournalLine: {
    name: "WHSCountingJournalLine",
    description: "Cycle count work line - one row per item/location counted, with expected vs counted quantity. Links to the WHSWorkTable work record that triggered the count.",
    module: "Warehouse Management – worksheet line (per legal entity)",
    docsUrl: "https://learn.microsoft.com/dynamics365/supply-chain/warehousing/cycle-counting",
    fields: [
      { name: "WorkId", type: "String", fkTarget: "WHSWorkTable.WorkId", note: "Count work the line belongs to." },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Item being counted." },
      { name: "InventDimId", type: "String", fkTarget: "InventDim.inventDimId", note: "Inventory dimensions of the counted location." },
      { name: "QtyCounted", type: "Decimal", note: "Quantity counted by the worker." },
      { name: "QtyExpected", type: "Decimal", note: "Expected quantity from the system." },
      { name: "CycleCountCounted", type: "Enum", note: "Whether the count line has been counted." },
      { name: "LineNum", type: "Decimal", note: "Line number within the count work." },
    ],
  },

  InventSettlement: {
    name: "InventSettlement",
    description: "Inventory cost settlement record created by the inventory close process. Each row links a financially posted receipt transaction (TransRecId) to a financially posted issue transaction (SettleTransId), recording the quantity settled and the cost adjustment amount. Cancelled settlements carry a NoYes Cancelled flag; the table's only self-reference is SettleTransId → SettleTransId, declared with RelationshipType Link. The settlement's own inventory transaction links to InventTransOrigin via InventTransId (a different column from SettleTransId, whose EDT is InventSettleTransId).",
    module: "Cost Management / Inventory Management – transaction line (per legal entity)",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/transactionline/inventsettlement",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK" },
      { name: "Voucher", type: "string", note: "GL voucher from the inventory close adjustment posting" },
      { name: "TransRecId", type: "int64", note: "FK → InventTrans.RecId (receipt side)" },
      { name: "Cancelled", type: "Enum", note: "Indicates the settlement record was cancelled." },
    ],
  },

  InventCostListTable: {
    name: "InventCostListTable",
    description: "BOM cost calculation list line (CDM entity: InventCostList). Stores the itemised cost component rows produced when rolling up a standard cost via the BOM cost calculation engine. Grouped into bundles; each row captures the item, BOM level, and cost contribution. Used during standard cost activation and inventory close recalculation. In CDM this entity is named InventCostList (Calculation list in TransactionLine).",
    module: "Cost Management – transaction line (per legal entity)",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/transactionline/inventcostlist",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK" },
      { name: "ItemId", type: "string", note: "FK → InventTable.ItemId; the item whose cost is captured" },
      { name: "BOMLevel", type: "int32", note: "BOM nesting depth level (0 = top-level item)" },
      { name: "Bundle", type: "int64", note: "FK → InventCostBundleList; groups rows from the same calculation run; nullable" },
      { name: "NumOfIteration", type: "int32", note: "Number of calculation iterations (for circular BOM detection); nullable, read-only" },
      { name: "Voucher", type: "string", note: "Calculation voucher; read-only" },
      { name: "DataAreaId", type: "string", note: "Legal-entity partition; read-only" },
    ],
  },

  // ── HR tables ──────────────────────────────
  // ── HR tables ──────────────────────────────
  HcmPosition: {
    name: "HcmPosition",
    description: "Individual position instance — one funded slot in the organization structure. Carries only the position identifier; the worker link is not a column on this table, it is the HcmPositionWorkerAssignment record, and hierarchy relationships are HcmPositionHierarchy rows.",
    module: "Human Resources",
    fields: [
      { name: "PositionId", type: "String", note: "Natural key, user-defined position ID." },
    ],
  },

  HcmPositionHierarchy: {
    name: "HcmPositionHierarchy",
    description: "Parent-child reporting relationship between two positions for a given hierarchy type (Line, Matrix, and so on). Date-effective: ValidFrom/ValidTo bound the relationship, and one position can appear in several hierarchies at once.",
    module: "Human Resources",
    fields: [
      { name: "Position", type: "Int64", fkTarget: "HcmPosition.RecId", note: "The child (reporting) position." },
      { name: "ParentPosition", type: "Int64", fkTarget: "HcmPosition.RecId", note: "The parent ('reports to') position." },
      { name: "PositionHierarchyType", type: "Int64", fkTarget: "HcmPositionHierarchyType.RecId", note: "Identifies which hierarchy this edge belongs to." },
      { name: "ValidFrom", type: "UtcDateTime", note: "Effective start of the reporting relationship." },
      { name: "ValidTo", type: "UtcDateTime", note: "Effective end; open-ended while the relationship is current." },
    ],
  },

  HcmWorker: {
    name: "HcmWorker",
    description: "Shared worker record for both employees and contractors. Identified by PersonnelNumber. Links to DirPerson for all personal/contact data stored in the Global Address Book. The employee-vs-contractor distinction is not a column on this table — it is modelled by the child tables HcmEmploymentEmployee and HcmEmploymentContractor, both linked through HcmEmployment.",
    module: "Human Resources",
    fields: [
      { name: "PersonnelNumber", type: "String(20)", note: "Natural key for the worker across the system" },
      { name: "Person", type: "Int64", note: "FK → DirPerson.RecId; links to the GAB party record for personal data" },
    ],
  },

  DirPerson: {
    name: "DirPerson",
    description: "Person record in the Global Address Book (GAB). Shared across all D365FO modules. Stores display name, language, name alias, initials and subtype discriminator. All HR worker personal data (name, contact info, address) ultimately traces back here.",
    module: "Global Address Book (Common)",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/common/gab/main/dirperson",
    fields: [
      { name: "RecId", type: "Int64", note: "PK; surrogate key referenced by HcmWorker.Person" },
      { name: "Name", type: "String(100)", note: "Full display name of the person" },
      { name: "NameAlias", type: "String(100)", note: "Nickname or alias; nullable" },
      { name: "Initials", type: "String(10)", note: "Initials of the person; nullable" },
      { name: "LanguageId", type: "String(7)", note: "Preferred language code; nullable" },
      { name: "NameSequenceDisplayAs", type: "Enum", note: "Display format for name (First Last vs Last, First)" },
      { name: "InstanceRelationType", type: "Int64", note: "Subtype discriminator linking to employee, contact, vendor, etc." },
    ],
  },

  HcmEmployment: {
    name: "HcmEmployment",
    description: "Employment period for a worker in one legal entity. Worker-to-legal-entity is this table, not a column on HcmWorker. EmploymentType distinguishes the employment relationship; the employee/contractor split is carried by the HcmEmploymentEmployee and HcmEmploymentContractor subtypes.",
    module: "Human Resources",
    fields: [
      { name: "DefaultDimension", type: "Int64", fkTarget: "DimensionAttributeValueSet.RecId", note: "Default financial dimension set for the employment." },
      { name: "EmploymentId", type: "String", note: "Natural key of the employment record." },
      { name: "EmploymentType", type: "Enum", note: "Employment relationship type (employee, contractor, and so on)." },
      { name: "LegalEntity", type: "Int64", fkTarget: "CompanyInfo.RecId", note: "The employing legal entity." },
      { name: "ValidFrom", type: "UtcDateTime", note: "Start of the employment period." },
      { name: "ValidTo", type: "UtcDateTime", note: "End of the employment period; open while the worker is employed." },
      { name: "Worker", type: "Int64", fkTarget: "HcmWorker.RecId", note: "The employed worker." },
    ],
  },

  HcmPositionWorkerAssignment: {
    name: "HcmPositionWorkerAssignment",
    description: "Bridge record that assigns a worker to a position for a validity period. This is the only real path between HcmPosition and HcmWorker — HcmPosition itself has no declared relation to the worker.",
    module: "Human Resources",
    fields: [
      { name: "Position", type: "Int64", fkTarget: "HcmPosition.RecId", note: "The position being filled." },
      { name: "ValidFrom", type: "UtcDateTime", note: "Start of the assignment." },
      { name: "ValidTo", type: "UtcDateTime", note: "End of the assignment; open while the worker holds the position." },
      { name: "Worker", type: "Int64", fkTarget: "HcmWorker.RecId", note: "The worker assigned to the position." },
    ],
  },

  HcmEmploymentEmployee: {
    name: "HcmEmploymentEmployee",
    description: "Employee subtype of HcmEmployment. One row per employment period held by an employee; carries the employee-only payroll, pay-scale and probation fields that a contractor employment has no use for.",
    module: "Human Resources",
    fields: [
      { name: "EmployeeSavingAmount", type: "Real", note: "Employee-side savings amount for the employment." },
      { name: "EmployerSavingAmount", type: "Real", note: "Employer-side savings amount for the employment." },
      { name: "Employment", type: "Int64", fkTarget: "HcmEmployment.RecId", note: "The employment period this employee record extends." },
      { name: "IncomeTaxCategory", type: "Int64", note: "Income tax category used for payroll." },
      { name: "IncomeTaxCode", type: "Int64", note: "Income tax code used for payroll." },
      { name: "MunicipalCountyCountryRegion", type: "String", note: "Municipal county country/region for local tax." },
      { name: "MunicipalCountyCounty", type: "String", note: "Municipal county for local tax." },
      { name: "MunicipalCountyState", type: "String", note: "Municipal county state for local tax." },
      { name: "PayrollCurrency", type: "String", note: "Currency used for this employment's payroll." },
      { name: "PayrollSalaryScaleDate", type: "Date", note: "Salary scale date driving pay-scale lookup." },
      { name: "PayrollSalarySeniorityDate", type: "Date", note: "Seniority date driving pay-scale lookup." },
      { name: "PayrollSalaryType", type: "Enum", note: "Salary type; enum HcmSalaryType." },
      { name: "PensionEnrollment", type: "UtcDateTime", note: "Pension enrollment date and time." },
      { name: "PensionStart", type: "UtcDateTime", note: "Pension start date and time." },
      { name: "ProbationEndDate", type: "UtcDateTime", note: "End of the probation period." },
      { name: "RelocationReimbursement", type: "Real", note: "Relocation reimbursement amount for the employee." },
      { name: "ValidFrom", type: "UtcDateTime", note: "Start of this employee record's validity." },
      { name: "ValidTo", type: "UtcDateTime", note: "End of this employee record's validity." },
    ],
  },

  HcmEmploymentContractor: {
    name: "HcmEmploymentContractor",
    description: "Contractor subtype of HcmEmployment. One row per employment period held by a contractor; ties the employment to the purchase order and vendor that supplied the contractor.",
    module: "Human Resources",
    fields: [
      { name: "Employment", type: "Int64", fkTarget: "HcmEmployment.RecId", note: "The employment period this contractor record extends." },
      { name: "PurchID", type: "String", note: "Purchase order covering the contractor engagement." },
      { name: "PurchReqTable", type: "Int64", note: "Purchase requisition record behind the engagement." },
      { name: "ValidFrom", type: "UtcDateTime", note: "Start of this contractor record's validity." },
      { name: "ValidTo", type: "UtcDateTime", note: "End of this contractor record's validity." },
      { name: "VendorDataAreaID", type: "String", note: "Legal entity that holds the vendor record." },
      { name: "VendorID", type: "String", note: "Vendor account that supplied the contractor." },
    ],
  },

  HcmOnboardProcessHeader: {
    name: "HcmOnboardProcessHeader",
    description: "Header of one onboarding process instance — the business-process header plus the worker and employment being onboarded. Onboarding tasks hang off this header; there is no separate checklist table.",
    module: "Human Resources",
    fields: [
      { name: "Employment", type: "Int64", fkTarget: "HcmEmployment.RecId", note: "The employment period being onboarded." },
      { name: "OnboardedEmployee", type: "Int64", fkTarget: "HcmWorker.RecId", note: "The worker being onboarded." },
      { name: "ProcessHeader", type: "Int64", note: "The business-process header this onboarding instance runs on." },
    ],
  },

  HcmOnboardProcessTask: {
    name: "HcmOnboardProcessTask",
    description: "One task inside a running onboarding process, optionally assigned to a position. Task configuration lives here and in HcmOnboardLibraryTask / HcmOnboardTemplateTask, not in a generic checklist table.",
    module: "Human Resources",
    fields: [
      { name: "AssignedPosition", type: "Int64", fkTarget: "HcmPosition.RecId", note: "Position the task is assigned to, when the assignment type is position." },
      { name: "AssignmentType", type: "Enum", note: "How the task is assigned (position, worker group, manager, and so on)." },
      { name: "Task", type: "Int64", note: "The business-process task this process task executes." },
    ],
  },

  HcmOnboardLibraryTask: {
    name: "HcmOnboardLibraryTask",
    description: "Onboarding task drawn from the business-process task library, with its optional position assignment. Library entries are the reusable task definitions that onboarding templates and running processes select from.",
    module: "Human Resources",
    fields: [
      { name: "AssignedPosition", type: "Int64", fkTarget: "HcmPosition.RecId", note: "Position the task is assigned to, when the assignment type is position." },
      { name: "AssignmentType", type: "Enum", note: "How the task is assigned (position, worker group, manager, and so on)." },
      { name: "LibraryTask", type: "Int64", note: "The library task this record configures." },
    ],
  },

  HcmOnboardTemplateTask: {
    name: "HcmOnboardTemplateTask",
    description: "Onboarding task placed in a process template, with its optional position assignment. Template tasks are copied into a running process when the template is applied to a worker.",
    module: "Human Resources",
    fields: [
      { name: "AssignedPosition", type: "Int64", fkTarget: "HcmPosition.RecId", note: "Position the task is assigned to, when the assignment type is position." },
      { name: "AssignmentType", type: "Enum", note: "How the task is assigned (position, worker group, manager, and so on)." },
      { name: "TemplateTask", type: "Int64", note: "The business-process template task this row configures." },
    ],
  },

  HcmOnboardTemplateAgentTasks: {
    name: "HcmOnboardTemplateAgentTasks",
    description: "Per-template configuration of the onboarding agent tasks — which onboarding steps are enabled for a business-process template, and under what task name and identifier.",
    module: "Human Resources",
    fields: [
      { name: "Description", type: "String", note: "Description of the configured agent task." },
      { name: "IsEnabled", type: "Enum", note: "Whether the agent task is enabled for the template." },
      { name: "Name", type: "Enum", note: "Which onboarding step the agent task represents; enum BusinessProcessEmployeeOnboardingStep." },
      { name: "TaskId", type: "Guid", note: "Identifier shared with the business-process task." },
      { name: "TaskName", type: "String", note: "Display name of the task." },
      { name: "TemplateHeader", type: "Int64", note: "The business-process template header these tasks belong to." },
    ],
  },

  HRMCompFixedPlanTable: {
    name: "HRMCompFixedPlanTable",
    description: "Fixed compensation plan: the pay structure, hire rule, tolerance and reference-point control for a fixed plan. This is the business table — the HcmComp*Staging tables are dual-write staging and carry no business meaning.",
    module: "Human Resources",
    fields: [
      { name: "ControlPoint", type: "String", note: "Reference point used as the plan's control point." },
      { name: "CurrencyCode", type: "String", note: "Currency for the plan's amounts." },
      { name: "Description", type: "String", note: "Plan description." },
      { name: "EnableRecommendation", type: "Enum", note: "Whether guideline recommendations are enabled; enum NoYes." },
      { name: "GridId", type: "String", note: "Compensation grid (structure) the plan uses." },
      { name: "HireRule", type: "Enum", note: "How new hires are handled; enum HRMCompHireRule." },
      { name: "MarketPriceIndicator", type: "Enum", note: "Whether the plan is flagged as a market-price indicator; enum NoYes." },
      { name: "PayFrequencyId", type: "String", note: "Pay frequency applied to the plan." },
      { name: "PlanId", type: "String", note: "Natural key of the fixed plan." },
      { name: "RestrictAccess", type: "Enum", note: "Whether access to the plan is restricted; enum NoYes." },
      { name: "Tolerance", type: "Enum", note: "Out-of-range tolerance; enum HRMCompTolerance." },
      { name: "Type", type: "Enum", note: "Compensation type; enum HcmCompensationType." },
      { name: "ValidFrom", type: "Date", note: "Start of the plan's validity." },
      { name: "ValidTo", type: "Date", note: "End of the plan's validity." },
    ],
  },

  HRMCompVarPlanTable: {
    name: "HRMCompVarPlanTable",
    description: "Variable compensation plan: award basis, leverage curve, vesting and unit configuration for a variable plan. Separate from the fixed plan — both are business tables under the HRMComp prefix.",
    module: "Human Resources",
    fields: [
      { name: "AwardBasis", type: "Enum", note: "What the award is based on; enum HRMCompVarAwardBasis." },
      { name: "AwardBasisCalculation", type: "Enum", note: "How the award basis is calculated; enum HRMCompVarPlanAwardBasis." },
      { name: "CalcType", type: "Enum", note: "Calculation type for the award; enum HRMCompVarPlanCalcType." },
      { name: "Description", type: "String", note: "Plan description." },
      { name: "EnableEnrollment", type: "Enum", note: "Whether enrollment is enabled; enum NoYes." },
      { name: "EnableLevels", type: "Enum", note: "Whether level overrides are enabled; enum NoYes." },
      { name: "EnableRecommendation", type: "Enum", note: "Whether guideline recommendations are enabled; enum NoYes." },
      { name: "HireRule", type: "Enum", note: "How new hires are handled; enum HRMCompHireRule." },
      { name: "Leverage100Percent", type: "Real", note: "Payout percentage at 100% of objective." },
      { name: "LeverageMaximum", type: "Real", note: "Upper bound of the leverage curve." },
      { name: "LeverageMinimum", type: "Real", note: "Lower bound of the leverage curve." },
      { name: "LeverageOverObjective", type: "Real", note: "Leverage applied above objective." },
      { name: "LeverageToleranceMax", type: "Enum", note: "Upper tolerance on the leverage curve; enum HRMCompTolerance." },
      { name: "LeverageToleranceMin", type: "Enum", note: "Lower tolerance on the leverage curve; enum HRMCompTolerance." },
      { name: "LeverageUnderObjective", type: "Real", note: "Leverage applied below objective." },
      { name: "PercentOfBasis", type: "Real", note: "Award percentage applied to the award basis." },
      { name: "PlanId", type: "String", note: "Natural key of the variable plan." },
      { name: "RestrictAccess", type: "Enum", note: "Whether access to the plan is restricted; enum NoYes." },
      { name: "TypeId", type: "String", note: "Variable plan type." },
      { name: "UnitCurrencyCode", type: "String", note: "Currency of the plan's units." },
      { name: "UnitRelationship", type: "Enum", note: "Whether the plan is unit-based; enum NoYes." },
      { name: "UnitValue", type: "Real", note: "Value of one unit." },
      { name: "UnitsReal", type: "Real", note: "Number of units granted." },
      { name: "ValidFrom", type: "Date", note: "Start of the plan's validity." },
      { name: "ValidTo", type: "Date", note: "End of the plan's validity." },
      { name: "VestingId", type: "String", note: "Vesting schedule applied to the plan." },
    ],
  },

  HRMCompEligibility: {
    name: "HRMCompEligibility",
    description: "Compensation eligibility rule — the job, job function, job type, department, union and location criteria that decide which workers a compensation plan applies to. Distinct from benefit eligibility.",
    module: "Human Resources",
    fields: [
      { name: "CompLocation", type: "Int64", note: "Compensation location criterion." },
      { name: "Department", type: "Int64", note: "Department criterion; an OMOperatingUnit reference." },
      { name: "Description", type: "String", note: "Rule description." },
      { name: "EligibilityId", type: "String", note: "Natural key of the eligibility rule." },
      { name: "EnableLevels", type: "Enum", note: "Whether level overrides apply; enum NoYes." },
      { name: "Job", type: "Int64", note: "Job criterion." },
      { name: "JobFunction", type: "Int64", note: "Job function criterion." },
      { name: "JobType", type: "Int64", note: "Job type criterion." },
      { name: "PlanId", type: "String", note: "The compensation plan the rule applies to." },
      { name: "PlanType", type: "Enum", note: "Whether the rule targets a fixed or variable plan; enum HRMCompPlanType." },
      { name: "Unions", type: "Int64", note: "Union criterion." },
      { name: "ValidFrom", type: "Date", note: "Start of the rule's validity." },
      { name: "ValidTo", type: "Date", note: "End of the rule's validity." },
    ],
  },

  HRMCompEvent: {
    name: "HRMCompEvent",
    description: "Compensation event header — one loaded compensation process run, with its load date, lock state, error status and the process it was loaded for. Events carry the per-worker compensation lines that the process awards.",
    module: "Human Resources",
    fields: [
      { name: "ErrorStatus", type: "Enum", note: "Load error status of the event; enum HRMCompEventErrorStatus." },
      { name: "EventId", type: "String", note: "Natural key of the compensation event." },
      { name: "LoadDate", type: "Date", note: "Date the event was loaded." },
      { name: "Locked", type: "Enum", note: "Whether the event is locked for editing; enum NoYes." },
      { name: "ProcessId", type: "String", fkTarget: "HRMCompProcess", note: "The compensation process the event belongs to." },
    ],
  },

  HRMCompProcess: {
    name: "HRMCompProcess",
    description: "Compensation process — the cycle configuration a run of compensation events executes against: cycle dates, point-in-time date, pro-rate hire date and process type.",
    module: "Human Resources",
    fields: [
      { name: "CycleFromDate", type: "Date", note: "Start of the compensation cycle." },
      { name: "CycleToDate", type: "Date", note: "End of the compensation cycle." },
      { name: "Description", type: "String", note: "Process description." },
      { name: "EnableFromMenu", type: "Enum", note: "Whether the process can be started from the menu; enum NoYes." },
      { name: "LoadDate", type: "Date", note: "Date the process was loaded." },
      { name: "PointInTimeDate", type: "Date", note: "Point-in-time date used when the process evaluates compensation." },
      { name: "ProRateHireDate", type: "Date", note: "Hire date used to pro-rate awards." },
      { name: "ProcessId", type: "String", note: "Natural key of the compensation process." },
      { name: "TransActiveDate", type: "Date", note: "Date the resulting compensation transactions become active." },
      { name: "Type", type: "Enum", note: "Process type; enum HRMCompProcessType." },
    ],
  },

  HcmCompensationLevel: {
    name: "HcmCompensationLevel",
    description: "Compensation level — a named level (with a type and sequence) that compensation structures and eligibility levels refer to. Level setup only; it holds no worker or plan assignment.",
    module: "Human Resources",
    fields: [
      { name: "CompensationLevelId", type: "String", note: "Natural key of the compensation level." },
      { name: "Description", type: "String", note: "Level description." },
      { name: "LineNum", type: "Real", note: "Display and ordering sequence." },
      { name: "Type", type: "Enum", note: "Compensation type the level belongs to; enum HcmCompensationType." },
    ],
  },

  HcmBenefitType: {
    name: "HcmBenefitType",
    description: "Benefit type — the category a benefit plan belongs to (medical, dental, life, retirement and so on), with its payroll category and concurrent-enrollment rule.",
    module: "Human Resources",
    fields: [
      { name: "BenefitTypeId", type: "String", note: "Natural key of the benefit type." },
      { name: "ConcurrentEnrollment", type: "Enum", note: "How concurrent enrollments of this type are handled." },
      { name: "Description", type: "String", note: "Type description." },
      { name: "PayrollCategory", type: "Enum", note: "Payroll category the type posts under." },
    ],
  },

  HcmBenefitOption: {
    name: "HcmBenefitOption",
    description: "Benefit option — a selectable coverage tier under a plan (employee only, employee plus spouse, and so on), flagged as dependent or beneficiary coverage where applicable.",
    module: "Human Resources",
    fields: [
      { name: "BenefitOptionID", type: "String", note: "Natural key of the benefit option." },
      { name: "Description", type: "String", note: "Option description." },
      { name: "IsBeneficiaryOption", type: "Enum", note: "Whether the option is a beneficiary (not worker) coverage; enum NoYes." },
      { name: "IsDependentOption", type: "Enum", note: "Whether the option covers dependents; enum NoYes." },
    ],
  },

  HcmBenefitEligibilityRule: {
    name: "HcmBenefitEligibilityRule",
    description: "Benefit eligibility rule — points at the expression (XPath query) that decides eligibility, or at a system policy rule. This is the benefit-side eligibility mechanism; compensation eligibility is HRMCompEligibility.",
    module: "Human Resources",
    fields: [
      { name: "ExpressionTable", type: "Int64", note: "The expression record holding the eligibility query." },
      { name: "IsExpressionChanged", type: "Enum", note: "Whether the referenced expression has changed since the rule was configured; enum NoYes." },
    ],
  },

  HcmBenefitEligibility: {
    name: "HcmBenefitEligibility",
    description: "Benefit eligibility process — one eligibility run with its event type, enrollment window, effective date, processing status and last processed date.",
    module: "Human Resources",
    fields: [
      { name: "BenefitEligibilityEvent", type: "Enum", note: "The event that triggered eligibility evaluation." },
      { name: "BenefitEligibilityId", type: "String", note: "Natural key of the eligibility record." },
      { name: "DaysToEnroll", type: "Int", note: "Enrollment window in days." },
      { name: "Description", type: "String", note: "Description of the eligibility record." },
      { name: "EligibilityEffectiveDate", type: "UtcDateTime", note: "Date the eligibility takes effect." },
      { name: "EnrollmentFromDate", type: "UtcDateTime", note: "First date enrollment is allowed." },
      { name: "LastProcessedDate", type: "Date", note: "Last date the eligibility was processed." },
      { name: "ProcessStatus", type: "Enum", note: "Processing status of the eligibility run." },
    ],
  },

  HcmLeaveType: {
    name: "HcmLeaveType",
    description: "Leave type definition. Carries the type identifier, its description and the payroll earning code it posts to; the leave taken against it lives on HcmEmploymentLeave and the vacation balance on HcmEmploymentVacation.",
    module: "Human Resources",
    fields: [
      { name: "EarningCode", type: "Int64", fkTarget: "PayrollEarningCode.RecId", note: "Payroll earning code the leave type posts to." },
      { name: "LeaveTypeID", type: "String", note: "Natural key of the leave type." },
      { name: "description", type: "String", note: "Leave type description." },
    ],
  },

  HcmEmploymentLeave: {
    name: "HcmEmploymentLeave",
    description: "Leave taken by an employment period — one row per leave absence with its leave type and start/end dates. This is the record of leave actually registered against the employment.",
    module: "Human Resources",
    fields: [
      { name: "Employment", type: "Int64", fkTarget: "HcmEmployment.RecId", note: "The employment period the leave belongs to." },
      { name: "EndDate", type: "Date", note: "Last day of the leave." },
      { name: "LeaveType", type: "Int64", fkTarget: "HcmLeaveType.RecId", note: "The leave type taken." },
      { name: "Note", type: "String", note: "Free-text note on the leave." },
      { name: "StartDate", type: "Date", note: "First day of the leave." },
    ],
  },

  HcmEmploymentVacation: {
    name: "HcmEmploymentVacation",
    description: "Vacation and holiday entitlement for an employment period: hours total, taken, carried over and left, plus the holiday pay flags. One record per employment validity period.",
    module: "Human Resources",
    fields: [
      { name: "Employment", type: "Int64", fkTarget: "HcmEmployment.RecId", note: "The employment period the entitlement belongs to." },
      { name: "HolidaysPerYear", type: "Real", note: "Number of holidays granted per year." },
      { name: "VacationHoursCarriedOver", type: "Real", note: "Vacation hours carried over from the previous period." },
      { name: "VacationHoursLeft", type: "Real", note: "Vacation hours still available." },
      { name: "VacationHoursTaken", type: "Real", note: "Vacation hours taken." },
      { name: "VacationHoursTotal", type: "Real", note: "Total vacation hours granted." },
      { name: "VacationPay", type: "Real", note: "Vacation pay amount." },
      { name: "ValidFrom", type: "UtcDateTime", note: "Start of the entitlement period." },
      { name: "ValidTo", type: "UtcDateTime", note: "End of the entitlement period." },
      { name: "isPaidHolidays", type: "Enum", note: "Whether holidays are paid." },
      { name: "isPaidPersonalDays", type: "Enum", note: "Whether personal days are paid." },
      { name: "isPaidVacation", type: "Enum", note: "Whether vacation is paid." },
    ],
  },

  HcmEmploymentTerm: {
    name: "HcmEmploymentTerm",
    description: "Employment term record — the agreement term that applies to an employment period. This is the real termination/term table; there is no separate separation table.",
    module: "Human Resources",
    fields: [
      { name: "AgreementTerm", type: "Int64", note: "The agreement term applied to the employment." },
      { name: "Employment", type: "Int64", fkTarget: "HcmEmployment.RecId", note: "The employment period the term applies to." },
      { name: "ValidFrom", type: "UtcDateTime", note: "Start of the term." },
      { name: "ValidTo", type: "UtcDateTime", note: "End of the term." },
    ],
  },

  HcmBenefit: {
    name: "HcmBenefit",
    description: "Worker benefit enrollment — links a benefit plan and a coverage option for a validity period. The worker link is through the plan/option configuration and the employment, not a worker column here.",
    module: "Human Resources",
    fields: [
      { name: "BenefitId", type: "String", note: "Natural key of the benefit enrollment." },
      { name: "BenefitOption", type: "Int64", fkTarget: "HcmBenefitOption.RecId", note: "The coverage option selected." },
      { name: "BenefitPlan", type: "Int64", fkTarget: "HcmBenefitPlan.RecId", note: "The benefit plan enrolled in." },
      { name: "ValidFrom", type: "UtcDateTime", note: "Start of the enrollment." },
      { name: "ValidTo", type: "UtcDateTime", note: "End of the enrollment." },
    ],
  },

  HcmBenefitPlan: {
    name: "HcmBenefitPlan",
    description: "Benefit plan definition — one plan of a given benefit type, with its payroll impact and ACA reportability. Workers are enrolled against it through HcmBenefit and its coverage options.",
    module: "Human Resources",
    fields: [
      { name: "ACAReportable", type: "Enum", note: "Whether the plan is ACA reportable; enum NoYes." },
      { name: "BenefitPlanID", type: "String", note: "Natural key of the benefit plan." },
      { name: "BenefitType", type: "Int64", fkTarget: "HcmBenefitType.RecId", note: "The benefit type the plan belongs to." },
      { name: "Description", type: "String", note: "Plan description." },
      { name: "PayrollImpact", type: "Enum", note: "How the plan affects payroll." },
    ],
  },

  // ── Service tables ──────────────────────────────
  SMAAgreementTable: {
    name: "SMAAgreementTable",
    description: "Service agreement header — defines the master terms, validity period, grouping rules, and project linkage for a recurring service agreement. Customer is accessed indirectly via ProjId → ProjTable.CustAccount (no direct CustAccount FK in CDM).",
    module: "Service Management",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/servicemanagement/worksheetheader/smaagreementtable",
    fields: [
      { name: "RecId", type: "int64", note: "PK – surrogate key" },
      { name: "AgreementId", type: "string", note: "Natural key / human-readable agreement identifier" },
      { name: "AgreementGroupId", type: "string", note: "FK → SMAAgreementGroup (for sorting/filtering)" },
      { name: "ProjId", type: "string", note: "FK → ProjTable – mandatory; drives customer, cost posting, and billing" },
      { name: "StartDate", type: "date", note: "Agreement validity start" },
      { name: "EndDate", type: "date", note: "Agreement validity end; nullable" },
      { name: "Suspended", type: "int32", note: "NoYes enum – if 1, no service orders can be generated from this agreement" },
      { name: "GroupBy", type: "int32", note: "Enum – controls how agreement lines are grouped into service orders (per line, task, or object)" },
      { name: "WorkerServiceResponsible", type: "string", note: "FK → HcmWorker – default responsible technician" },
      { name: "ServiceLevelAgreementId", type: "string", note: "FK → SMAServiceLevelAgreementTable; nullable" },
      { name: "ActivityTypeId", type: "String", note: "FK → smmActivityTypeGroup – activity type stamped on the CRM activity for the agreement." },
      { name: "AgreementDescription", type: "String", note: "Free-text description of the agreement, shown on agreement lists." },
      { name: "ContactPersonId", type: "String", note: "FK → ContactPerson – customer contact for the visit." },
      { name: "ContinuousService_IN", type: "Enum", note: "NoYes – India continuous-service indicator consumed by the service tax rules." },
      { name: "ServiceEventGroup_IN", type: "String", note: "India service-event group code consumed by the service tax rules." },
      { name: "TemplateGroupId", type: "String", note: "FK → SMATemplateGroup – default task/object template applied to orders generated from the agreement." },
      { name: "WorkerPreferredTechnician", type: "Int64", note: "FK → HcmWorker – customer-preferred technician; nullable." },
    ],
  },

  SMAAgreementLine: {
    name: "SMAAgreementLine",
    description: "Service agreement line — defines a specific service work item within an agreement: what is done (transaction type), how often (interval), by whom (worker), on which object, and to which project category.",
    module: "Service Management",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/servicemanagement/worksheetline/smaagreementline",
    fields: [
      { name: "RecId", type: "int64", note: "PK – surrogate key" },
      { name: "AgreementId", type: "string", note: "FK → SMAAgreementTable.AgreementId – parent header (readonly)" },
      { name: "AgreementLineNum", type: "decimal", note: "Line number within the agreement (readonly)" },
      { name: "TransactionType", type: "int32", note: "Enum – line type: Hour=0, Item=1, Expense=2, Fee=3" },
      { name: "ProjCategoryId", type: "string", note: "FK → ProjCategory – service or cost category for posting" },
      { name: "ProjId", type: "string", note: "FK → ProjTable – inherited from header (readonly)" },
      { name: "IntervalId", type: "string", note: "FK → SMAAgreementInterval – how often service orders are auto-generated; nullable" },
      { name: "ServiceObjectRelationId", type: "string", note: "FK → SMAServiceObjectRelation – which object instance is covered; nullable" },
      { name: "ServiceTaskId", type: "string", note: "FK → SMAServiceTask – work task classification; nullable" },
      { name: "Worker", type: "string", note: "FK → HcmWorker – assigned technician for this line; nullable" },
      { name: "Suspended", type: "int32", note: "NoYes – stops auto-generation of orders for this specific line" },
      { name: "ActivityNumber", type: "String", note: "FK → smmActivities – CRM activity created for the line; nullable." },
      { name: "DefaultDimension", type: "Int64", note: "FK → DimensionAttributeValueSet – financial dimensions stamped on the posted line." },
      { name: "Description", type: "String", note: "Free-text order description shown on the order and the dispatch board." },
      { name: "DescriptionService", type: "String", note: "Service description printed on the service report for this line." },
      { name: "EndDate", type: "Date", note: "Date the line coverage ends; nullable." },
      { name: "InventDimId", type: "String", note: "FK → InventDim – inventory dimensions for an item-type line; nullable." },
      { name: "ItemId", type: "String", note: "FK → InventTable – item serviced by an item-type line; nullable." },
      { name: "ItemSetupType", type: "Enum", note: "Enum SMAItemSetupType – how the item is set up on the line (standard item or BOM template)." },
      { name: "ProjCurrencyId", type: "String", note: "FK → Currency – sales currency used for project posting." },
      { name: "ProjLinePropertyId", type: "String", note: "FK → ProjLineProperty – line property that drives billable/chargeable handling." },
      { name: "ProjTaxGroupId", type: "String", note: "FK → TaxGroupHeading – sales tax group for posting." },
      { name: "ProjTaxItemGroupId", type: "String", note: "FK → TaxItemGroupHeading – item sales tax group for posting." },
      { name: "ProjTransTxt", type: "String", note: "Transaction text written on the project transaction." },
      { name: "Qty", type: "Real", note: "Quantity covered per interval (hours or units, per TransactionType)." },
      { name: "ServiceObjectId", type: "String", note: "FK → SMAServiceObjectTable – service object worked on; nullable." },
      { name: "ServiceTimeEndBefore", type: "Time", note: "Latest time of day the work must finish; nullable." },
      { name: "ServiceTimeStartAfter", type: "Time", note: "Earliest time of day the work may start; nullable." },
      { name: "StartDate", type: "Date", note: "Date the line coverage starts." },
      { name: "TimeAgreementId", type: "String", note: "FK → SMATimeAgreement – time agreement constraining the allowed service window." },
      { name: "Unit", type: "String", note: "FK → UnitOfMeasure – unit of measure for Qty." },
    ],
  },

  SMAServiceOrderTable: {
    name: "SMAServiceOrderTable",
    description: "Service order header — represents a planned or ad-hoc service visit to a customer site. Can be generated automatically from a service agreement or created manually. Tracks stage, priority, and technician assignment.",
    module: "Service Management",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/servicemanagement/worksheetheader/smaserviceordertable",
    fields: [
      { name: "RecId", type: "int64", note: "PK – surrogate key" },
      { name: "ServiceOrderId", type: "string", note: "Natural key – auto-generated order number (readonly)" },
      { name: "AgreementId", type: "string", note: "FK → SMAAgreementTable.AgreementId – nullable; null if created without an agreement" },
      { name: "CustAccount", type: "string", note: "FK → CustTable – customer being serviced" },
      { name: "ProjId", type: "string", note: "FK → ProjTable – associated project for cost/revenue posting; nullable" },
      { name: "ServiceDateTime", type: "datetime", note: "Preferred service date and time; nullable" },
      { name: "StageId", type: "string", note: "FK → SMAStageTable – workflow stage of the order (readonly)" },
      { name: "Priority", type: "Enum", note: "Enum – order priority level; nullable" },
      { name: "WorkerResponsible", type: "Int64", note: "FK → HcmWorker – technician responsible for the order; nullable" },
      { name: "SignOff", type: "Enum", note: "NoYes – whether the order has been signed off by the technician" },
      { name: "ActivityNumber", type: "String", note: "FK → smmActivities – CRM activity created for the line; nullable." },
      { name: "ActivityTypeId", type: "String", note: "FK → smmActivityTypeGroup – activity type stamped on the CRM activity for the agreement." },
      { name: "AddressRefRecId", type: "Int64", note: "Surrogate key of the order address record; interpreted through AddressRefTableId." },
      { name: "AddressRefTableId", type: "Int", note: "Table id of the order address record; with AddressRefRecId forms a polymorphic address pointer." },
      { name: "CalendarConflict", type: "Enum", note: "NoYes – the service time conflicts with the technician calendar." },
      { name: "CertifiedPayroll", type: "Enum", note: "NoYes – the order falls under certified-payroll reporting." },
      { name: "Compliance", type: "Real", note: "Service-level-agreement compliance percentage recorded for the order." },
      { name: "ContactPersonId", type: "String", note: "FK → ContactPerson – customer contact for the visit." },
      { name: "Description", type: "String", note: "Free-text order description shown on the order and the dispatch board." },
      { name: "IncomingWebOrder", type: "Enum", note: "NoYes – the order arrived through the web channel." },
      { name: "Origin", type: "Enum", note: "Enum SMAServiceOrderOrigin – how the parent order was created." },
      { name: "Progress", type: "Enum", note: "Enum SMAServiceOrderProgress – progress of the order through its stages." },
      { name: "ServiceAddressName", type: "String", note: "Name on the address where the service is performed." },
      { name: "ServiceLevelAgreement", type: "String", note: "FK → SMAServiceLevelAgreementTable – SLA applied to this order; nullable." },
      { name: "ServiceLevelAgreementStatus", type: "Enum", note: "Enum SMALogStatus – current SLA status of the order." },
      { name: "ServicePostalAddress", type: "Int64", note: "FK → LogisticsPostalAddress – postal address where the service is performed." },
      { name: "SignOffDateTime", type: "UtcDateTime", note: "UTC timestamp the customer signed off the work." },
      { name: "WorkerPreferredTechnician", type: "Int64", note: "FK → HcmWorker – customer-preferred technician; nullable." },
      { name: "SysRowVersionNumber", type: "Int64", note: "Internal row-version token used for optimistic concurrency." },
    ],
  },

  SMAServiceOrderLine: {
    name: "SMAServiceOrderLine",
    description: "Service order line — individual task or activity on a service order. Each line represents hours worked, an item (spare part) consumed, an expense, or a fee. Posted to the project for billing.",
    module: "Service Management",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/servicemanagement/worksheetline/smaserviceorderline",
    fields: [
      { name: "RecId", type: "int64", note: "PK – surrogate key" },
      { name: "ServiceOrderId", type: "string", note: "FK → SMAServiceOrderTable.ServiceOrderId – parent header" },
      { name: "ServiceOrderLineNum", type: "decimal", note: "Line sequence number within the order (readonly)" },
      { name: "ProjCategoryId", type: "string", note: "FK → ProjCategory – service activity category; drives posting rules" },
      { name: "ItemId", type: "string", note: "FK → InventTable – spare part or material; nullable (only for Item-type lines)" },
      { name: "InventDimId", type: "string", note: "FK → InventDim – inventory dimensions (site, warehouse, serial) for the item; nullable" },
      { name: "ServiceObjectRelationId", type: "string", note: "FK → SMAServiceObjectRelation – the specific object instance being worked on; nullable" },
      { name: "ActivityId", type: "string", note: "FK → dispatch activity record – links to scheduling/dispatch; readonly, nullable" },
      { name: "DateExecution", type: "date", note: "Actual date the service was performed; nullable" },
      { name: "Qty", type: "decimal", note: "Quantity (hours, units, etc.)" },
      { name: "AgreementId", type: "string", note: "FK → SMAAgreementTable – originating agreement line; nullable, readonly" },
      { name: "ProjCurrencyCode", type: "String", note: "FK → Currency – sales currency used for project posting." },
      { name: "ActivityNumber", type: "String", note: "FK → smmActivities – CRM activity created for the line; nullable." },
      { name: "AgreementLineNum", type: "Int", note: "Agreement line number the order line consumes; populated only for agreement-based orders." },
      { name: "CurrencyIdCost", type: "String", note: "FK → Currency – cost currency of the line." },
      { name: "DateCalculated", type: "Date", note: "Date the line price/qty was last calculated." },
      { name: "DateRangeFrom", type: "Date", note: "Start of the date range the line covers; nullable." },
      { name: "DateRangeTo", type: "Date", note: "End of the date range the line covers; nullable." },
      { name: "DefaultDimension", type: "Int64", note: "FK → DimensionAttributeValueSet – financial dimensions stamped on the posted line." },
      { name: "Description", type: "String", note: "Free-text order description shown on the order and the dispatch board." },
      { name: "DescriptionService", type: "String", note: "Service description printed on the service report for this line." },
      { name: "InvoiceId", type: "String", note: "Invoice identifier stamped when the line is invoiced." },
      { name: "IsSalesPriceModified", type: "Enum", note: "NoYes – sales price was overridden from the project price." },
      { name: "LedgerDimension", type: "Int64", note: "FK → DimensionAttributeValueCombination – main account and dimensions for expense posting." },
      { name: "OffsetAccountTypeExpense", type: "Enum", note: "Enum LedgerJournalACType – account type of the offset account for expense lines." },
      { name: "Origin", type: "Enum", note: "Enum SMAServiceOrderOrigin – how the parent order was created." },
      { name: "ProjCostPrice", type: "Real", note: "Cost price per unit for project posting." },
      { name: "ProjId", type: "String", note: "FK → ProjTable – project the line posts cost and revenue to." },
      { name: "ProjLinePropertyId", type: "String", note: "FK → ProjLineProperty – line property that drives billable/chargeable handling." },
      { name: "ProjSalesPrice", type: "Real", note: "Sales price per unit for project posting." },
      { name: "ProjTaxGroup", type: "String", note: "FK → TaxGroupHeading – sales tax group for posting." },
      { name: "ProjTaxItemGroup", type: "String", note: "FK → TaxItemGroupHeading – item sales tax group for posting." },
      { name: "ProjTransId", type: "String", note: "Project transaction id created when the line is posted." },
      { name: "ProjTransTxt", type: "String", note: "Transaction text written on the project transaction." },
      { name: "ServiceObjectId", type: "String", note: "FK → SMAServiceObjectTable – service object worked on; nullable." },
      { name: "ServiceOrderStatus", type: "Enum", note: "Enum SMAServiceOrderStatus – line-level status (created, posted, invoiced, cancelled)." },
      { name: "ServiceTaskId", type: "String", note: "FK → SMAServiceTask – work task classification for the line; nullable." },
      { name: "ServiceTimeEndBefore", type: "Time", note: "Latest time of day the work must finish; nullable." },
      { name: "ServiceTimeStartAfter", type: "Time", note: "Earliest time of day the work may start; nullable." },
      { name: "SignOff", type: "Enum", note: "NoYes – the line has been signed off (customer sign-off or automatic on posting)." },
      { name: "TaxGroupExpense", type: "String", note: "FK → TaxGroupHeading – sales tax group used for expense-type lines." },
      { name: "TaxItemGroupExpense", type: "String", note: "FK → TaxItemGroupHeading – item sales tax group used for expense-type lines." },
      { name: "TimeSheetEndTime", type: "Time", note: "Time of day the technician finished the work; feeds hour-journal posting." },
      { name: "TimeSheetStartTime", type: "Time", note: "Time of day the technician started the work; feeds hour-journal posting." },
      { name: "TransactionType", type: "Enum", note: "Enum SMATransactionType – line type: hour, item, expense, or fee." },
      { name: "Unit", type: "String", note: "FK → UnitOfMeasure – unit of measure for Qty." },
      { name: "Worker", type: "Int64", note: "FK → HcmWorker – worker assigned to the dispatch team." },
      { name: "PackedExtensions", type: "Container", note: "Serialized SysExtension payload for line extensions; not a business field." },
      { name: "AssessableValue_IN", type: "Real", note: "India GST – assessable value of the line used as the tax base." },
      { name: "CompanyLocation_IN", type: "Int64", note: "India GST – location (address record) of the company for place-of-supply determination." },
      { name: "CustomerLocation_IN", type: "Int64", note: "India GST – location (address record) of the customer for place-of-supply determination." },
      { name: "CustomerTaxInformation_IN", type: "Int64", note: "India GST – customer tax registration record used on the tax document." },
      { name: "CustomsTariffCodeTable_IN", type: "Int64", note: "India – customs tariff code applied to the line." },
      { name: "DirectSettlement_IN", type: "Enum", note: "Enum – India direct-settlement flag for the excise invoice." },
      { name: "DSA_IN", type: "Enum", note: "NoYes – India dealer-sales-account flag." },
      { name: "ExciseRecordType_IN", type: "Enum", note: "Enum – India excise record type for the line." },
      { name: "ExciseTariffCodes_IN", type: "Int64", note: "India – excise tariff code record for the line." },
      { name: "ExciseType_IN", type: "Enum", note: "Enum – India excise type (manufacture or trading)." },
      { name: "Exempt_IN", type: "Enum", note: "NoYesId – line is exempt from India GST." },
      { name: "HSNCodeTable_IN", type: "Int64", note: "India GST – HSN/SAC code record for the line." },
      { name: "ITCCategory_IN", type: "Enum", note: "Enum – India input-tax-credit category for the line." },
      { name: "MaximumRetailPrice_IN", type: "Real", note: "India GST – maximum retail price printed on the package." },
      { name: "PostalAddress_IN", type: "Int64", note: "India GST – postal address record used for the tax document." },
      { name: "SalesTaxFormTypes_IN", type: "Int64", note: "India – sales tax form type attached to the line." },
      { name: "ServiceAccountingCodeTable_IN", type: "Int64", note: "India GST – service accounting code (SAC) record for the line." },
      { name: "ServiceCodeTable_IN", type: "Int64", note: "India – service code record for the line." },
      { name: "TaxInventVATCommodityCodeId_IN", type: "String", note: "India – VAT commodity code for the item on the line." },
      { name: "TCSGroup_IN", type: "String", note: "India – tax-collected-at-source group applied to the line." },
      { name: "TDSGroup_IN", type: "String", note: "India – tax-deducted-at-source group applied to the line." },
      { name: "VendorLocation_IN", type: "Int64", note: "India GST – vendor location record used when the line originates from an external vendor." },
      { name: "VendorTaxInformation_IN", type: "Int64", note: "India GST – vendor tax registration record used on the tax document." },
      { name: "WarehouseLocation_IN", type: "Int64", note: "India GST – warehouse location record for the line." },
    ],
  },

  SMAServiceObjectTable: {
    name: "SMAServiceObjectTable",
    description: "Service object — the physical equipment, asset, or item that is being serviced (e.g., elevator, boiler, machine). Identified by a service object ID and optionally linked to a specific inventory item instance via InventDim (serial/batch).",
    module: "Service Management",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/servicemanagement/main/smaserviceobjecttable",
    fields: [
      { name: "RecId", type: "int64", note: "PK – surrogate key" },
      { name: "ServiceObjectId", type: "string", note: "Natural key – human-readable object identifier" },
      { name: "Description", type: "string", note: "Text description of the service object; nullable" },
      { name: "ItemId", type: "string", note: "FK → InventTable – product type/model of the asset; nullable" },
      { name: "InventDimId", type: "string", note: "FK → InventDim – identifies a specific serialized/batched unit; nullable" },
      { name: "ServiceObjectGroup", type: "string", note: "FK → SMAServiceObjectGroup – object classification group" },
      { name: "TemplateBOMId", type: "string", note: "FK → SMATemplateBOMTable – template bill of materials for the object; nullable" },
    ],
  },

  SMAServiceObjectRelation: {
    name: "SMAServiceObjectRelation",
    description: "Service object relation — associative record linking a specific service object instance (SMAServiceObjectTable) to a service agreement line, service order, or service order line. RelTableId + RelKeyId determine which document the object is attached to.",
    module: "Service Management",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/servicemanagement/main/smaserviceobjectrelation",
    fields: [
      { name: "RecId", type: "int64", note: "PK – surrogate key" },
      { name: "ServiceObjectRelationId", type: "string", note: "Natural key for this relation record" },
      { name: "ServiceObjectId", type: "string", note: "FK → SMAServiceObjectTable.ServiceObjectId – the object being related" },
      { name: "RelTableId", type: "int32", note: "AOS table ID of the related document (discriminator for polymorphic FK)" },
      { name: "RelKeyId", type: "string", note: "Natural key of the related document (agreement ID or service order ID)" },
      { name: "InventDimId", type: "string", note: "FK → InventDim – serial/batch dimension for the object instance; nullable" },
      { name: "TemplateBOMId", type: "string", note: "FK → SMATemplateBOMTable – may override the object's default template; nullable" },
      { name: "SalesId", type: "string", note: "FK → SalesTable – if object originated from a sales order; readonly, nullable" },
      { name: "ServiceObjectRef", type: "String", note: "Free-text reference for the object as the customer knows it (tag, serial, location); another table can be the owner instead, discriminated by RelTableId." },
    ],
  },

  SMADispatchBoard: {
    name: "SMADispatchBoard",
    description: "Dispatch team - groups service technicians for dispatch assignment. The dispatch board itself is a form (SMADispatchBoard), not a table.",
    module: "Service Management",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/supply-chain/service-management/dispatch-board",
    fields: [
      { name: "DispatchTeamId", type: "String", fkTarget: "SMADispatchTeamTable.DispatchTeamId", note: "Dispatch team identifier." },
      { name: "Description", type: "String", note: "Description of the dispatch team." },
      { name: "WorkerOwner", type: "Int64", fkTarget: "HcmWorker.RecId", note: "Worker who owns the dispatch team." },
    ],
  },

  ResResource: {
    name: "ResResource",
    description: "Resource identifier (ResResourceIdentifier in CDM) — each record maps a schedulable resource (person or machine) to its backing WrkCtrTable entry. The RecId of this table is the 'resource ID' used across project scheduling, resource booking, and service dispatch activities.",
    module: "Project Management and Accounting / Service Management",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/miscellaneous/resresourceidentifier",
    fields: [
      { name: "RecId", type: "int64", note: "PK – the resource ID referenced by ResBooking, ResAssignment, and service dispatch" },
      { name: "RefRecId", type: "int64", note: "FK → WrkCtrTable.RecId (or HcmWorker.RecId) – the backing record; determined by RefTableId" },
      { name: "RefTableId", type: "int32", note: "AOS table ID discriminator – identifies whether backing record is WrkCtrTable (machine) or HcmWorker (person)" },
    ],
  },

  WrkCtrTable: {
    name: "WrkCtrTable",
    description: "Work center / resource — shared table used by both Production Control and Service Management. Defines a schedulable capacity unit: an individual person, machine, or resource group. Technicians appear here with IsIndividualResource=1.",
    module: "Supply Chain / Production Control / Service Management",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/salesandmarketing/main/wrkctrtable",
    fields: [
      { name: "RecId", type: "int64", note: "PK – surrogate key" },
      { name: "Name", type: "string", note: "Display name of the resource or work center; nullable" },
      { name: "IsIndividualResource", type: "Enum", note: "NoYes – 1 = individual person resource (technician), 0 = machine or group" },
      { name: "Capacity", type: "decimal", note: "Available capacity amount per period; nullable" },
      { name: "EffectivityPct", type: "decimal", note: "Efficiency percentage (e.g., 90 = 90% productive); nullable" },
      { name: "ProcessCategoryId", type: "string", note: "FK → RouteCostCategory – cost category for processing time; nullable" },
      { name: "SetUpCategoryId", type: "string", note: "FK → RouteCostCategory – cost category for setup time; nullable" },
      { name: "Exclusive", type: "Enum", note: "Exclusive scheduling flag – prevents double-booking; nullable" },
    ],
  },

  SMAContractTable: {
    name: "SMAContractTable",
    description: "Service contract — header table capturing billing terms and coverage scope for a customer service contract, linked to subscriptions and service agreements. NOTE: Not published as a standalone table in the CDM schema; in D365FO SCM, service billing contracts are managed through SMASubscriptionTable (recurring) and SMAAgreementTable (project-based).",
    module: "Service Management",
    docsUrl: "https://learn.microsoft.com/dynamics365/supply-chain/service-management/service-subscriptions",
    fields: [
      { name: "RecId", type: "int64", note: "PK – surrogate key" },
      { name: "ContractId", type: "string", note: "Natural key – contract identifier" },
      { name: "CustAccount", type: "string", note: "FK → CustTable – the billing customer" },
      { name: "Name", type: "string", note: "Contract description / name" },
      { name: "ProjId", type: "string", note: "FK → ProjTable – project used for cost and revenue tracking" },
      { name: "StartDate", type: "date", note: "Contract coverage start date" },
      { name: "EndDate", type: "date", note: "Contract coverage end date; nullable" },
      { name: "Status", type: "int32", note: "Enum – Active / Suspended / Cancelled" },
    ],
  },

  SMASubscriptionTable: {
    name: "SMASubscriptionTable",
    description: "Service subscription — defines a recurring billing subscription for a customer. Stores the subscription ID, billing group, project linkage, fee category, base price, and currency. Subscription fee transactions (SMASubscriptionTrans) are created from this record for each invoicing period.",
    module: "Service Management",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/servicemanagement/main/smasubscriptiontable",
    fields: [
      { name: "RecId", type: "int64", note: "PK – surrogate key" },
      { name: "SubscriptionId", type: "string", note: "Natural key – human-readable subscription identifier" },
      { name: "Name", type: "string", note: "Subscription description; nullable" },
      { name: "Active", type: "Enum", note: "NoYes – active flag; nullable" },
      { name: "BasePrice", type: "decimal", note: "Base price per period; nullable" },
      { name: "CurrencyCode", type: "string", note: "FK → Currency – billing currency" },
      { name: "GroupId", type: "string", note: "FK → SMASubscriptionGroup – defines invoicing period and accrual settings" },
      { name: "ProjId", type: "string", note: "FK → ProjTable – subscription revenue posted to this project" },
      { name: "ProjCategoryId", type: "string", note: "FK → ProjCategory – fee category for subscription revenue posting" },
      { name: "StartDate", type: "date", note: "Subscription start date (readonly, computed); nullable" },
      { name: "LatestEnddate", type: "date", note: "Latest computed end date of all fee transactions (readonly); nullable" },
      { name: "SubscriptionIndex", type: "Real", note: "Index that orders subscriptions inside a subscription group." },
      { name: "TaxInformation_IN", type: "Int64", note: "India GST – tax registration record used when invoicing the subscription fee." },
    ],
  },

  SMASubscriptionTrans: {
    name: "SMASubscriptionTrans",
    description: "Subscription transaction — records each fee transaction (Regular, Credit, Reduction days, Accrual) generated for a service subscription. These are the source lines proposed for invoicing; after posting, they are linked to a CustInvoiceJour record. NOTE: Physical D365FO table not published in CDM schema (CDM Transaction folder contains only SMAAccruePeriodLine and related tables).",
    module: "Service Management",
    docsUrl: "https://learn.microsoft.com/dynamics365/supply-chain/service-management/create-subscription-fee-transactions",
    fields: [
      { name: "RecId", type: "int64", note: "PK – surrogate key" },
      { name: "SubscriptionId", type: "string", note: "FK → SMASubscriptionTable – parent subscription" },
      { name: "TransactionType", type: "int32", note: "Enum – Regular=1, CreditNote=2, ReductionDays=3, Accrual=4" },
      { name: "PeriodFrom", type: "date", note: "Start of the fee coverage period" },
      { name: "PeriodTo", type: "date", note: "End of the fee coverage period" },
      { name: "Amount", type: "decimal", note: "Transaction fee amount in subscription currency" },
      { name: "CurrencyCode", type: "string", note: "FK → Currency – transaction currency" },
      { name: "InvoiceId", type: "string", note: "FK → CustInvoiceJour – populated after the fee transaction is invoiced; nullable" },
      { name: "Status", type: "int32", note: "Enum – Open / Invoiced / Cancelled" },
    ],
  },

  // ── PTP tables ──────────────────────────────
  ReqTrans: {
    name: "ReqTrans",
    description: "Net requirements / planned orders generated by master planning. Each row represents one planned production, purchase, or transfer order created or updated during a plan run. CDM display name: 'Net requirements'.",
    module: "SupplyChain / MasterPlanning / Transaction",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/masterplanning/transaction/reqtrans",
    fields: [
      { name: "RecId", type: "int64", note: "" },
      { name: "ItemId", type: "string", note: "" },
      { name: "PlanVersion", type: "int64", note: "" },
      { name: "ReqDate", type: "date", note: "" },
      { name: "Qty", type: "Decimal", note: "Planned order quantity." },
      { name: "ActionType", type: "int32", note: "" },
      { name: "ActionDate", type: "date", note: "" },
      { name: "FuturesDays", type: "decimal", note: "" },
      { name: "ItemBomId", type: "string", note: "" },
      { name: "ItemRouteId", type: "string", note: "" },
      { name: "CovInventDimId", type: "string", note: "" },
      { name: "OpenStatus", type: "int32", note: "" },
      { name: "ActionDays", type: "decimal", note: "" },
      { name: "Level", type: "int32", note: "" },
    ],
  },

  ReqPlanData: {
    name: "ReqPlanData",
    description: "Master plan data settings — stores coverage parameters per item–coverage group combination within a master plan. Controls reorder point, minimum/maximum quantities, safety stock, and the coverage code (Period, Requirement, Min/Max) that governs how planned orders are calculated for each item in the plan.",
    module: "Master Planning",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/coverage-settings",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "FK to the item these coverage settings apply to" },
      { name: "ReqPlanId", type: "String", fkTarget: "ReqPlanSched.ReqPlanIdSched", note: "FK to the master plan this data row belongs to" },
      { name: "CovCode", type: "Enum", note: "Coverage code: 0=Period, 1=Requirement, 2=MinMax, 3=Manual" },
      { name: "MinQty", type: "Decimal", note: "Minimum on-hand quantity (safety stock) to maintain" },
      { name: "MaxQty", type: "Decimal", note: "Maximum on-hand quantity target (used with Min/Max coverage)" },
      { name: "ReorderPoint", type: "Decimal", note: "On-hand level at which a replenishment order is triggered" },
      { name: "LeadTime", type: "Int32", note: "Override lead time in days for this item in this plan" },
    ],
  },

  ReqPlanSched: {
    name: "ReqPlanSched",
    description: "Master plan schedule definition — each record configures one named master plan (scheduling method, time fences, margins, etc.). A plan run reads this record and generates ReqTrans rows. CDM display name: 'Master plan setup'.",
    module: "SupplyChain / MasterPlanning / Group",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/masterplanning/group/reqplansched",
    fields: [
      { name: "RecId", type: "int64", note: "" },
      { name: "ReqPlanIdSched", type: "string", note: "" },
      { name: "Name", type: "string", note: "" },
      { name: "CovSchedMethod", type: "int32", note: "" },
      { name: "TimeFenceAction", type: "int32", note: "" },
      { name: "FuturesSched", type: "int32", note: "" },
      { name: "IncludeRequisitions", type: "int32", note: "" },
      { name: "IncludePlannedIntercompanyDemand", type: "int32", note: "" },
      { name: "IssueMargin", type: "decimal", note: "" },
      { name: "ReceiptMargin", type: "decimal", note: "" },
      { name: "OrderingMargin", type: "decimal", note: "" },
      { name: "BottleneckScheduling", type: "int32", note: "" },
    ],
  },

  ReqPO: {
    name: "ReqPO",
    description: "Planned purchase order — a firmed or unfirmed planned order for a purchased item generated by master planning. Represents the system's recommendation to create a purchase order for a quantity on a date. Can be firmed (converted to a real PO) or adjusted before firming.",
    module: "Master Planning",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/planned-order-firming",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Item to be purchased" },
      { name: "ReqDate", type: "Date", note: "Required receipt date (demand date) driving the planned order" },
      { name: "Qty", type: "Decimal", note: "Planned order quantity in purchase unit" },
      { name: "VendId", type: "String", fkTarget: "VendTable.AccountNum", note: "Preferred vendor for the planned purchase order." },
      { name: "PlanVersion", type: "Int64", fkTarget: "ReqPlanVersion.RecId", note: "FK to the plan version this planned order belongs to" },
      { name: "ReqPOStatus", type: "Enum", note: "Planned order status (unfirmed, firmed, completed, etc.)." },
    ],
  },

  ReqPOPlanVersion: {
    name: "ReqPOPlanVersion",
    description: "Master plan version - each plan run creates a version record; planned orders (ReqPO, ReqTrans) reference it via PlanVersion.",
    module: "Master Planning",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/master-planning-setup",
    fields: [
      { name: "ReqPlanId", type: "String", fkTarget: "ReqPlan.ReqPlanId", note: "Master plan the version belongs to." },
      { name: "Active", type: "Enum", note: "Whether this plan version is active." },
      { name: "LastCostCalculationDateTime", type: "UtcDateTime", note: "Timestamp of the last cost calculation for the plan run." },
    ],
  },

  InventForecastTable: {
    name: "InventForecastTable",
    description: "Sales forecast lines (demand forecast) used as input to master planning. The D365FO AOT table is ForecastSales.",
    module: "SupplyChain / MasterPlanning / WorksheetLine",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/masterplanning/worksheetline/forecastsales",
    fields: [
      { name: "RecId", type: "int64", note: "" },
      { name: "ItemId", type: "string", note: "" },
      { name: "StartDate", type: "Date", note: "Start date of the forecast period." },
      { name: "ModelId", type: "string", note: "" },
      { name: "SalesQty", type: "Decimal", note: "Forecast sales quantity for the period." },
      { name: "CustAccountId", type: "string", note: "" },
      { name: "CustGroupId", type: "string", note: "" },
      { name: "InventDimId", type: "string", note: "" },
      { name: "ItemBOMId", type: "string", note: "" },
      { name: "ItemRouteId", type: "string", note: "" },
      { name: "AllocateMethod", type: "int32", note: "" },
      { name: "Active", type: "int32", note: "" },
    ],
  },

  ReqItemTable: {
    name: "ReqItemTable",
    description: "Item coverage settings per item (master planning): coverage group, coverage time fence, minimum and maximum on-hand quantities, and related planning parameters. Not a transaction table.",
    module: "Master Planning / Production Control",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/demand-forecasting-setup",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Item the coverage settings apply to." },
      { name: "ReqGroupId", type: "String", fkTarget: "ReqGroup.ReqGroupId", note: "Coverage group for the item." },
      { name: "CovTimeFence", type: "Int", note: "Coverage time fence in days (named TimeFenceCoverage in AOT)." },
      { name: "MinInventOnhand", type: "Decimal", note: "Minimum on-hand quantity (reorder point)." },
      { name: "MaxInventOnhand", type: "Decimal", note: "Maximum on-hand quantity." },
    ],
  },

  BOMTable: {
    name: "BOMTable",
    description: "Bill of materials header — defines a named BOM that lists component materials. A BOM must be approved and linked to items via BOMVersion before it can be used in production. CDM display name: 'Bills of materials'.",
    module: "SupplyChain / ProductInformationManagement / Main",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productinformationmanagement/main/bomtable",
    fields: [
      { name: "RecId", type: "int64", note: "" },
      { name: "BOMId", type: "string", note: "" },
      { name: "Name", type: "string", note: "" },
      { name: "Approved", type: "int32", note: "" },
      { name: "Approver", type: "int64", note: "" },
      { name: "CheckBOM", type: "int32", note: "" },
      { name: "ItemGroupId", type: "string", note: "" },
      { name: "SiteId", type: "string", note: "" },
      { name: "PmfBOMFormula", type: "int32", note: "" },
    ],
  },

  BOMVersion: {
    name: "BOMVersion",
    description: "BOM version — links a finished/semi-finished item (InventTable) to a BOM header (BOMTable) with a date-effective, site-specific, quantity-range activation record. Only the active approved version is used during production order creation and cost calculation. CDM display name: 'BOM versions'.",
    module: "SupplyChain / ProductInformationManagement / Main",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productinformationmanagement/main/bomversion",
    fields: [
      { name: "RecId", type: "int64", note: "" },
      { name: "BOMId", type: "string", note: "" },
      { name: "ItemId", type: "string", note: "" },
      { name: "Active", type: "int32", note: "" },
      { name: "Approved", type: "int32", note: "" },
      { name: "FromDate", type: "date", note: "" },
      { name: "ToDate", type: "date", note: "" },
      { name: "InventDimId", type: "string", note: "" },
    ],
  },

  RouteTable: {
    name: "RouteTable",
    description: "Production route header — defines a named route that groups a sequence of operations. Route versions (RouteVersion) link items to routes; RouteOpr records define each operation's properties within a route. CDM display name: 'Routes'.",
    module: "SupplyChain / ProductionControl / Main",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productioncontrol/main/routetable",
    fields: [
      { name: "RecId", type: "int64", note: "" },
      { name: "RouteId", type: "string", note: "" },
      { name: "Name", type: "string", note: "" },
      { name: "Approved", type: "int32", note: "" },
      { name: "Approver", type: "int64", note: "" },
      { name: "CheckRoute", type: "int32", note: "" },
      { name: "ItemGroupId", type: "string", note: "" },
    ],
  },

  RouteOpr: {
    name: "RouteOpr",
    description: "Operation relation — stores the operational properties (times, cost categories, work center assignments) for an operation (RouteOprTable) as it appears within a specific route (RouteTable) or for a specific item. Supports three relation scopes: All routes, Specific route, Specific item+route. CDM display name: 'Operation relation'.",
    module: "SupplyChain / ProductionControl / Main",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productioncontrol/main/routeopr",
    fields: [
      { name: "RecId", type: "int64", note: "" },
      { name: "OprId", type: "string", note: "" },
      { name: "RouteCode", type: "int32", note: "" },
      { name: "RouteRelation", type: "string", note: "" },
      { name: "ItemCode", type: "int32", note: "" },
      { name: "ItemRelation", type: "string", note: "" },
      { name: "SetupTime", type: "decimal", note: "" },
      { name: "ProcessTime", type: "decimal", note: "" },
      { name: "ProcessPerQty", type: "decimal", note: "" },
      { name: "SetUpCategoryId", type: "string", note: "" },
      { name: "ProcessCategoryId", type: "string", note: "" },
      { name: "RouteGroupId", type: "string", note: "" },
      { name: "QueueTimeBefore", type: "decimal", note: "" },
      { name: "QueueTimeAfter", type: "decimal", note: "" },
    ],
  },

  ProdTable: {
    name: "ProdTable",
    description: "Production order header — the master record for a discrete production order. Tracks status, quantities, BOM/route assignments, scheduling dates, and links to the item being produced. CDM display name: 'Production orders'.",
    module: "SupplyChain / ProductionControl / WorksheetHeader",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productioncontrol/worksheetheader/prodtable",
    fields: [
      { name: "ProdId", type: "string", note: "" },
      { name: "ItemId", type: "string", note: "" },
      { name: "BOMId", type: "string", note: "" },
      { name: "BOMDate", type: "date", note: "" },
      { name: "DlvDate", type: "date", note: "" },
      { name: "InventDimId", type: "string", note: "" },
      { name: "Name", type: "string", note: "" },
      { name: "ProdStatus", type: "int32", note: "" },
      { name: "ProdGroupId", type: "string", note: "" },
      { name: "ProdType", type: "int32", note: "" },
      { name: "QtySched", type: "decimal", note: "" },
      { name: "FinishedDate", type: "date", note: "" },
    ],
  },

  ProdBOM: {
    name: "ProdBOM",
    description: "Production BOM line — component material requirements for a specific production order. Derived from the BOM version at order creation; each line represents one component (item) to be consumed. CDM display name: 'Production BOM'.",
    module: "SupplyChain / ProductionControl / WorksheetLine",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productioncontrol/worksheetline/prodbom",
    fields: [
      { name: "RecId", type: "int64", note: "" },
      { name: "ProdId", type: "string", note: "" },
      { name: "ItemId", type: "string", note: "" },
      { name: "BOMId", type: "string", note: "" },
      { name: "BOMConsump", type: "int32", note: "" },
      { name: "BOMQty", type: "Decimal", note: "BOM quantity per production unit." },
      { name: "QtyBOMCalc", type: "Decimal", note: "Calculated quantity for this component in the BOM calculation." },
      { name: "InventDimId", type: "string", note: "" },
      { name: "LineNum", type: "decimal", note: "" },
    ],
  },

  ProdRoute: {
    name: "ProdRoute",
    description: "Production route line — the operations to be performed for a specific production order. Derived from the route version at order creation. Tracks scheduled and actual times per operation. CDM display name: 'Production route'.",
    module: "SupplyChain / ProductionControl / WorksheetLine",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productioncontrol/worksheetline/prodroute",
    fields: [
      { name: "RecId", type: "int64", note: "" },
      { name: "ProdId", type: "string", note: "" },
      { name: "OprNum", type: "int32", note: "" },
      { name: "WrkCtrIdCost", type: "String", fkTarget: "WrkCtrTable.WrkCtrId", note: "Work center used for cost calculations of the operation." },
      { name: "SetUpCategoryId", type: "string", note: "" },
      { name: "CalcSetUp", type: "decimal", note: "" },
      { name: "CalcProc", type: "decimal", note: "" },
      { name: "CalcQty", type: "decimal", note: "" },
      { name: "ErrorPct", type: "decimal", note: "" },
      { name: "ExecutedProcess", type: "decimal", note: "" },
    ],
  },

  ProdJournalTable: {
    name: "ProdJournalTable",
    description: "Production journal header — represents one unposted or posted journal for a production order. Journal types include picking list (BOM consumption), route card (operation time), and report-as-finished (RAF). CDM display name: 'Production journal table'.",
    module: "SupplyChain / ProductionControl / WorksheetHeader",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productioncontrol/worksheetheader/prodjournaltable",
    fields: [
      { name: "JournalId", type: "string", note: "" },
      { name: "JournalNameId", type: "string", note: "" },
      { name: "Description", type: "string", note: "" },
      { name: "ProdId", type: "string", note: "" },
      { name: "Posted", type: "int32", note: "" },
      { name: "DrawNegative", type: "int32", note: "" },
      { name: "JournalNameIdPickList", type: "string", note: "" },
      { name: "JournalNameIdReportFinish", type: "string", note: "" },
      { name: "AutoReportFinished", type: "int32", note: "" },
      { name: "EndJob", type: "int32", note: "" },
    ],
  },

  ProdJournalBOM: {
    name: "ProdJournalBOM",
    description: "BOM journal (picking list) transaction line — the consumption side of a production order. One line per component drawn from inventory, recording the proposal, the actual consumption (InventConsump → BOMConsump), and scrap (BOMScrap) in both inventory and BOM units. CDM display name: 'BOM journal transactions'. Sibling subtypes: ProdJournalProd (report as finished) and ProdJournalRoute (route card).",
    module: "SupplyChain / ProductionControl / WorksheetLine",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productioncontrol/worksheetline/prodjournalbom",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key; the row identity used by the journal's line sequence" },
      { name: "JournalId", type: "String", fkTarget: "ProdJournalTable.JournalId", note: "FK to the production journal header; the header determines whether this is a picking-list or report-as-finished journal" },
      { name: "LineNum", type: "Decimal", note: "Line sequence within the journal; pairs with JournalError.LineNum for validation errors" },
      { name: "ProdId", type: "String", fkTarget: "ProdTable.ProdId", note: "FK to the production order consuming the component" },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Component (ingredient) item being consumed — mandatory" },
      { name: "InventDimId", type: "String", fkTarget: "InventDim.InventDimId", note: "Inventory dimensions (site/warehouse/location/batch) the component is picked from" },
      { name: "InventTransId", type: "String", fkTarget: "InventTransOrigin.InventTransId", note: "Inventory transaction origin — links this consumption line to the InventTrans issue it creates on posting" },
      { name: "InventTransChildRefId", type: "String", note: "Child reference id for the InventTrans records created by posting this line" },
      { name: "InventTransChildType", type: "Enum", note: "Child transaction type that qualifies InventTransChildRefId" },
      { name: "OprNum", type: "Int", note: "Route operation the component is consumed at, for operation-level backflushing" },
      { name: "BOMUnitId", type: "String", fkTarget: "UnitOfMeasure.Symbol", note: "Unit of measure in which the BOM quantities are expressed — mandatory" },
      { name: "InventProposal", type: "Real", note: "System-proposed consumption in inventory units, calculated from the BOM line and production quantity" },
      { name: "InventConsump", type: "Real", note: "Actual inventory quantity consumed; differs from the proposal when the picker overrides or backflushes" },
      { name: "BOMProposal", type: "Real", note: "System-proposed consumption in BOM units (proposal × unit conversion)" },
      { name: "BOMConsump", type: "Real", note: "Actual consumption in BOM units — the quantity that costs the production order" },
      { name: "BOMScrap", type: "Real", note: "Scrap quantity in BOM units, recorded on top of the consumed quantity" },
      { name: "PdsCWInventProposal", type: "Real", note: "Catch-weight proposal — process-manufacturing catch weight on the proposed quantity" },
      { name: "PdsCWInventConsump", type: "Real", note: "Catch-weight actual consumption for process-manufacturing items" },
      { name: "EndConsump", type: "Enum", note: "NoYes — flags the final consumption line for the component when reporting the last operation as finished" },
      { name: "ErrorCause", type: "Enum", note: "ProdErrorCause — classifies why the reported consumption/RAF quantity was wrong" },
      { name: "InventReturnFlag", type: "Enum", note: "NoYes — the line is a return (negative consumption) rather than an issue" },
      { name: "InventControlProposal", type: "Enum", note: "NoYes — consume the full quantity regardless of the on-hand (inventory control) proposal" },
      { name: "Position", type: "String", note: "BOMPosition — numbered position of the component on the BOM, used for assembly/scrap reporting" },
      { name: "MatchId", type: "String", note: "Match id tying this line to the as-built BOM lot association (traceability)" },
      { name: "ActivityNumber", type: "String", fkTarget: "smmActivities.ActivityNumber", note: "Project activity the consumption is booked to" },
      { name: "DefaultDimension", type: "Int64", fkTarget: "DimensionAttributeValueSet.RecId", note: "Financial dimension value set posted with the consumption" },
      { name: "ProjId", type: "String", fkTarget: "ProjTable.ProjId", note: "Project the production consumption is charged to" },
      { name: "ProjCategoryId", type: "String", fkTarget: "ProjCategory.CategoryId", note: "Project category for the consumption cost line" },
      { name: "ProjLinePropertyId", type: "String", fkTarget: "ProjLineProperty.LinePropertyId", note: "Project line property (chargeable / non-chargeable) for the consumption" },
      { name: "ProjTransId", type: "String", fkTarget: "ProjItemTrans.ProjTransId", note: "FK to the project item transaction created when the consumption posts" },
      { name: "ProjCostAmount", type: "Real", note: "Cost amount for the project consumption line" },
      { name: "ProjCostPrice", type: "Real", note: "Cost price per unit used for the project consumption line" },
      { name: "ProjSalesPrice", type: "Real", note: "Sales price per unit when the consumption is billed to the project customer" },
      { name: "ProjSalesCurrencyId", type: "String", fkTarget: "ProjectSalesCurrency.CurrencyCode", note: "Currency of ProjSalesPrice" },
      { name: "ProjTaxGroupId", type: "String", fkTarget: "ProjectTaxGroupHeading.TaxGroup", note: "Sales tax group for the project consumption line" },
      { name: "ProjTaxItemGroupId", type: "String", fkTarget: "ProjectTaxItemGroupHeading.TaxItemGroup", note: "Item sales tax group for the project consumption line" },
      { name: "Voucher", type: "String", note: "Ledger voucher generated when the journal posts" },
      { name: "TransDate", type: "Date", note: "Posting date of the journal line — mandatory, drives the inventory and ledger period" },
      { name: "FinTag", type: "Int64", fkTarget: "FinTag.RecId", note: "Financial tag used for ledger dimension derivation" },
      { name: "PackedExtensions", type: "Container", note: "Serialized SysExtension payload for extensible fields added by extensions" },
      { name: "StornoPhysical_RU", type: "Enum", note: "NoYes — Russia-only storno (reversal) flag for physical postings" },
    ],
  },

  ProdJournalProd: {
    name: "ProdJournalProd",
    description: "Report-as-finished (RAF) production journal line — one line of a production journal that posts finished goods (QtyGood) and error/scrap quantities (QtyError) from a production order. Physically the table behind 'Production journal transactions'; sibling journal subtypes are ProdJournalBOM (picking list) and ProdJournalRoute (route card).",
    module: "SupplyChain / ProductionControl / WorksheetLine",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productioncontrol/worksheetline/prodjournalprod",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key; referenced by PdsBatchAttributesInput.RefRecId for batch attribute input on RAF lines" },
      { name: "JournalId", type: "String", fkTarget: "ProdJournalTable", note: "FK to the production journal header (ProdJournalTable.JournalId)" },
      { name: "ProdId", type: "String", fkTarget: "ProdTable", note: "FK to the production order being reported as finished" },
      { name: "ItemId", type: "String", fkTarget: "InventTable", note: "Finished item being reported; must match the production order's finished product" },
      { name: "InventDimId", type: "String", fkTarget: "InventDim", note: "Inventory dimensions (site/warehouse/batch) for the finished quantity" },
      { name: "InventTransId", type: "String", fkTarget: "InventTransOrigin", note: "Inventory transaction origin linking this RAF line to its inventory movements" },
      { name: "LineNum", type: "Decimal", note: "Line sequence within the journal; pairs with JournalError.LineNum for validation errors" },
      { name: "ProdPickListJournalId", type: "String", fkTarget: "ProdJournalTable", note: "FK back to the picking-list journal header (ProdJournalTable.JournalId) for the BOM consumption that accompanies RAF" },
      { name: "ReleaseKindId_RU", type: "String", fkTarget: "ProdReleaseKindTable_RU", note: "Russia-specific release kind (per-release posting) — empty outside RU localization" },
    ],
  },

  ProdRouteJob: {
    name: "ProdRouteJob",
    description: "Scheduled production job — each operation on a production order is broken into one or more jobs (setup, process, queue, transport) during job scheduling. Stores scheduled start/end date-times and execution status. CDM display name: 'Route jobs'.",
    module: "SupplyChain / ProductionControl / WorksheetLine",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productioncontrol/worksheetline/prodroutejob",
    fields: [
      { name: "JobId", type: "string", note: "" },
      { name: "ProdId", type: "string", note: "" },
      { name: "OprNum", type: "int32", note: "" },
      { name: "WrkCtrId", type: "string", note: "" },
      { name: "JobType", type: "int32", note: "" },
      { name: "JobStatus", type: "int32", note: "" },
      { name: "FromDate", type: "date", note: "" },
      { name: "FromTime", type: "int32", note: "" },
      { name: "CalcTimeHours", type: "decimal", note: "" },
      { name: "ExecutedPct", type: "decimal", note: "" },
      { name: "JobFinished", type: "int32", note: "" },
    ],
  },

  ProdCalcTrans: {
    name: "ProdCalcTrans",
    description: "Production cost calculation transaction — stores the itemized cost estimate or actual cost lines for a production order, broken down by cost component (material, operation, overhead). Generated during Estimate and Costing steps. CDM display name: 'Calculation'.",
    module: "SupplyChain / ProductionControl / Transaction",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productioncontrol/transaction/prodcalctrans",
    fields: [
      { name: "RecId", type: "int64", note: "" },
      { name: "CollectRefProdId", type: "string", note: "" },
      { name: "CalcType", type: "int32", note: "" },
      { name: "CostAmount", type: "decimal", note: "" },
      { name: "CostGroupId", type: "string", note: "" },
      { name: "ConsumpConstant", type: "decimal", note: "" },
      { name: "ConsumpVariable", type: "decimal", note: "" },
      { name: "OprId", type: "string", note: "" },
      { name: "OprNum", type: "int32", note: "" },
      { name: "Qty", type: "decimal", note: "" },
      { name: "InventDimId", type: "string", note: "" },
    ],
  },

  CostCalculationResult: {
    name: "CostCalculationResult",
    description: "Cost calculation result — stores the output of a BOM/route cost calculation for an item or production order. Each row holds one cost component line (material, labor, overhead, subcontracting) broken down by cost group and cost version. Used to review estimated vs. realised production costs.",
    module: "Cost Management / Production Control",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/supply-chain/cost-management/bom-calculations",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Item for which the cost was calculated" },
      { name: "CostingVersionId", type: "String", note: "FK to the costing version containing the cost data" },
      { name: "CostGroupId", type: "String", note: "Cost group classifying this cost line (Material, Labor, Overhead, etc.)" },
      { name: "CalcType", type: "Enum", note: "Calculation type: 0=Standard, 1=Realized — distinguishes estimates from actuals" },
      { name: "CostAmount", type: "Decimal", note: "Calculated cost amount for this component line" },
      { name: "Qty", type: "Decimal", note: "Quantity the cost amount is based on" },
      { name: "InventDimId", type: "String", fkTarget: "InventDim.inventDimId", note: "Inventory dimension (site/warehouse) the cost applies to" },
    ],
  },

  // ── PROJ tables ──────────────────────────────
  ProjTable: {
    name: "ProjTable",
    description: "Master project record — the header for all project transactions, forecasts, and billing. Every posted transaction references ProjId. In D365FO, 'project' is the operational unit that drives cost, revenue, and WIP.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/main/projtable",
    fields: [
      { name: "ProjId", type: "string", note: "Natural key — unique project identifier within company" },
      { name: "Name", type: "string", note: "Descriptive project name" },
      { name: "ProjGroupId", type: "string", note: "FK → ProjGroup; drives all GL posting behaviour" },
      { name: "ProjInvoiceProjId", type: "string", note: "FK → ProjInvoiceTable (billing contract); projects billed under the same invoice project share one contract" },
      { name: "WorkerResponsible", type: "int64", note: "FK → HcmWorker; project manager responsible for delivery" },
      { name: "Status", type: "int32", note: "Enum: 1=InProcess, 2=Finished, 3=Postponed — controls whether new transactions can be posted" },
      { name: "StartDate", type: "date", note: "Planned project start date" },
      { name: "EndDate", type: "date", note: "Planned project end / completion date" },
    ],
  },

  ProjGroup: {
    name: "ProjGroup",
    description: "Project group — a configuration master that determines how transactions are posted to the general ledger (P&L vs WIP balance sheet), revenue accrual method, and matching principle for fixed-price projects.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/group/projgroup",
    fields: [
      { name: "ProjGroupId", type: "string", note: "Natural key — project group identifier" },
      { name: "Name", type: "string", note: "Display name for the group" },
      { name: "LedgerPosting", type: "int32", note: "Enum: controls whether cost posts to P&L (No WIP) or balance sheet (WIP)" },
      { name: "MatchingPrincip", type: "int32", note: "Fixed-price revenue recognition method: Completed contract, Percentage completion, etc." },
      { name: "EmplTransCost", type: "int32", note: "Hour transaction posting behaviour (Cost account)" },
      { name: "CostTransTurnover", type: "int32", note: "Flag: accrue revenue on expense transactions" },
      { name: "RevenueTransTurnover", type: "int32", note: "Flag: accrue revenue on fee/revenue transactions" },
      { name: "AccruedCostCategoryId", type: "string", note: "FK → ProjCategory; default category for accrued-loss adjustments" },
    ],
  },

  ProjFundingSource: {
    name: "ProjFundingSource",
    description: "Funding source linked to a project billing contract — identifies who (customer, grant, organisation) funds the project and at what percentage/priority. One contract can have multiple funding sources, each with allocation rules and limits.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/main/projfundingsource",
    fields: [
      { name: "FundingSourceId", type: "string", note: "Natural key — funding source identifier within the contract" },
      { name: "ContractId", type: "string", note: "FK → ProjInvoiceTable.ProjInvoiceProjId (the billing contract)" },
      { name: "CustAccount", type: "string", note: "FK → CustTable; customer account if FundingType = Customer" },
      { name: "FundingType", type: "int32", note: "Enum: Customer, Grant, Organisation" },
      { name: "Party", type: "int64", note: "FK → DirPartyTable; generic party link for non-customer funders" },
      { name: "PaymentTermsId", type: "string", note: "Payment terms applied to this funding source's invoices" },
      { name: "PostingProfile", type: "string", note: "Customer posting profile override for this funding source" },
    ],
  },

  ProjContract: {
    name: "ProjContract",
    description: "Project billing contract (called 'Invoice project' in the D365FO UI; CDM entity name ProjInvoiceTable) — the sales-side contract that governs how one or more projects are invoiced. Defines payment terms, invoice format, currency, and is the parent of ProjFundingSource records. ProjTable.ProjInvoiceProjId is the FK into this table.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/main/projinvoicetable",
    fields: [
      { name: "ProjInvoiceId", type: "string", note: "Natural key — billing contract ID (referenced as ContractId by ProjFundingSource)" },
      { name: "Name", type: "string", note: "Invoicing name / contract description" },
      { name: "CurrencyId", type: "string", note: "Invoicing currency for this contract" },
      { name: "Payment", type: "string", note: "FK → PaymTerms; payment terms applied to all invoices under this contract" },
      { name: "NumberSequenceGroupId", type: "string", note: "Number sequence group controlling invoice numbering" },
      { name: "PSAProgressInvoicing", type: "int32", note: "Flag: enables progress invoicing (partial billing) for fixed-price" },
      { name: "PSARetainPercent", type: "decimal", note: "Customer retention / holdback percentage deducted from invoices" },
    ],
  },

  ProjPlanVersion: {
    name: "ProjPlanVersion",
    description: "Project WBS task hierarchy containing task identifiers, schedule, effort, cost and revenue estimates, and task status.",
    module: "Project Management and Accounting",
    fields: [
      { name: "ActivityTaskTimeType", type: "Enum", note: "Enum smmActivityTaskTimeType" },
      { name: "EndNode", type: "Enum", note: "Enum FalseTrue" },
      { name: "HierarchyId", type: "String", note: "EDT HierarchyIdBase" },
      { name: "HierarchyLevel", type: "Int", note: "EDT ProjHierarchyLevel" },
      { name: "HierarchyTaskId", type: "Int64", note: "EDT ProjHierarchyTaskId" },
      { name: "HierarchyTreeTableRefRecId", type: "Int64", note: "EDT RefRecId" },
      { name: "IsCategoryMandatory", type: "Enum", note: "Enum NoYes" },
      { name: "IsTaskClosed", type: "Enum", note: "Enum NoYes" },
      { name: "IsTaskMandatory", type: "Enum", note: "Enum NoYes" },
      { name: "MSPID", type: "Guid", note: "No EDT/enum recorded" },
      { name: "NumberOfResources", type: "Real", note: "EDT NumberOfResources" },
      { name: "ParentHierarchyTaskId", type: "Int64", note: "No EDT recorded" },
      { name: "PathId", type: "String", note: "EDT ProjHierarchyPathId" },
      { name: "ResourceCategory", type: "Int64", note: "EDT ResourceCategoryRecId" },
      { name: "TaskAssignedHours", type: "Real", note: "EDT Hours" },
      { name: "TaskCategory", type: "String", note: "EDT ProjCategoryId" },
      { name: "TaskCostAtComplete", type: "Real", note: "EDT ProjTotalCostAmount" },
      { name: "TaskDuration", type: "Real", note: "EDT DaysAsReal" },
      { name: "TaskEffort", type: "Real", note: "EDT Hours" },
      { name: "TaskEffortAtComplete", type: "Real", note: "EDT Hours" },
      { name: "TaskEffortToComplete", type: "Real", note: "EDT Hours" },
      { name: "TaskFinishDate", type: "Date", note: "EDT SchedToDate" },
      { name: "TaskName", type: "String", note: "EDT ProjTaskName" },
      { name: "TaskPriority", type: "Enum", note: "Enum smmActivityPriority" },
      { name: "TaskProjectedCost", type: "Real", note: "EDT AmountMST" },
      { name: "TaskProjectedEndDate", type: "Date", note: "EDT SchedToDate" },
      { name: "TaskProjectedRevenue", type: "Real", note: "EDT AmountMST" },
      { name: "TaskSchedulingStatus", type: "Enum", note: "Enum PSAScheduled" },
      { name: "TaskSiblingNumber", type: "Real", note: "EDT LineNum" },
      { name: "TaskStartDate", type: "Date", note: "EDT SchedFromDate" },
      { name: "TaskStatus", type: "Enum", note: "Enum smmActivityTaskTimeType" },
      { name: "UserMemo", type: "String", note: "EDT smmActivityUserMemo" },
    ],
  },

  ProjPlanVersionDetail: {
    name: "ProjPlanVersionDetail",
    description: "Project WBS plan-version detail linking project and hierarchy identifiers to a plan version.",
    module: "Project Management and Accounting",
    fields: [
      { name: "Description", type: "String", note: "EDT Description" },
      { name: "HierarchyId", type: "String", note: "EDT HierarchyIdBase" },
      { name: "IsActiveBaseline", type: "Enum", note: "Enum NoYes" },
      { name: "IsBaseline", type: "Enum", note: "Enum NoYes" },
      { name: "IsTemplate", type: "Enum", note: "EDT smmActivityIsTemplate; enum NoYes" },
      { name: "ProjId", type: "String", note: "EDT ProjId" },
      { name: "VersionId", type: "Real", note: "EDT ProjVersionId" },
      { name: "VersionName", type: "String", note: "EDT Name" },
      { name: "VersionType", type: "Enum", note: "Enum ProjPlanVersionType" },
    ],
  },

  ProjLineProperty: {
    name: "ProjLineProperty",
    description: "Project line property setup controlling whether project transactions are billable, invoiced, accrued, or capitalized.",
    module: "Project Management and Accounting",
    fields: [
      { name: "CostMarkup", type: "Real", note: "EDT ProjMarkupPct" },
      { name: "LinePropertyId", type: "String", note: "EDT ProjLinePropertyId" },
      { name: "Name", type: "String", note: "EDT ProjLinePropertyName" },
      { name: "NormBillable", type: "Enum", note: "Enum NoYes" },
      { name: "NormEfficiency", type: "Enum", note: "Enum NoYes" },
      { name: "OnInvoice", type: "Enum", note: "EDT ProjInvoiceZeroSalesPrice; enum NoYes" },
      { name: "OnQuotation", type: "Enum", note: "EDT ProjQuotationZeroSalesPrice; enum NoYes" },
      { name: "SalesMarkup", type: "Real", note: "EDT ProjMarkupPct" },
      { name: "ToBeAccrued", type: "Enum", note: "EDT ProjAccruable; enum boolean" },
      { name: "ToBeCapitalize", type: "Enum", note: "EDT ProjCapitalize; enum boolean" },
      { name: "ToBeInvoiced", type: "Enum", note: "Enum NoYes" },
      { name: "isEfficiency", type: "Enum", note: "Enum NoYes" },
    ],
  },

  ProjEmplTrans: {
    name: "ProjEmplTrans",
    description: "Posted employee (hour) transaction on a project — the subledger record created when an hour journal is posted. Each row represents one resource's time charged to a project for a given date, category, and line property. Drives cost and optionally accrued revenue.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/transaction/projempltrans",
    fields: [
      { name: "TransId", type: "string", note: "Natural key — unique transaction ID assigned at posting" },
      { name: "ProjId", type: "string", note: "FK → ProjTable; the project charged" },
      { name: "Worker", type: "int64", note: "FK → HcmWorker; the employee or contractor who logged the hours" },
      { name: "CategoryId", type: "string", note: "FK → ProjCategory; work category (e.g. Development, Consulting)" },
      { name: "TransDate", type: "date", note: "Date the hours were worked / posted" },
      { name: "TotalCostAmountCur", type: "decimal", note: "Total cost amount in transaction currency (hours × cost price)" },
      { name: "TotalSalesAmountCur", type: "decimal", note: "Total sales/revenue amount in transaction currency" },
      { name: "VoucherJournal", type: "string", note: "GL voucher number; matches SubledgerVoucherGeneralJournalEntry.Voucher, which resolves to the GeneralJournalEntry header" },
    ],
  },

  ProjItemTrans: {
    name: "ProjItemTrans",
    description: "Posted item (material) transaction on a project — subledger record created when an item journal, packing slip, or purchase invoice is posted against a project. Captures quantity, cost, and optionally sales amount for material consumption.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/transaction/projitemtrans",
    fields: [
      { name: "ProjTransId", type: "string", note: "Natural key — unique transaction ID" },
      { name: "ProjId", type: "string", note: "FK → ProjTable; project the material was consumed against" },
      { name: "ItemId", type: "string", note: "FK → InventTable; the inventory item consumed" },
      { name: "CategoryId", type: "string", note: "FK → ProjCategory; project category for the item line" },
      { name: "TransDate", type: "date", note: "Date of the material transaction" },
      { name: "Qty", type: "decimal", note: "Quantity consumed" },
      { name: "TotalCostAmountCur", type: "decimal", note: "Total cost in transaction currency" },
      { name: "TotalSalesAmountCur", type: "decimal", note: "Total sales amount in transaction currency (for T&M billing)" },
    ],
  },

  ProjCostTrans: {
    name: "ProjCostTrans",
    description: "Posted expense/cost transaction on a project — subledger record created when an expense journal or fee journal is posted. Represents non-labour direct costs such as travel, accommodation, or subcontractor charges.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/transaction/projcosttrans",
    fields: [
      { name: "TransId", type: "string", note: "Natural key — unique transaction ID" },
      { name: "ProjId", type: "string", note: "FK → ProjTable; the project charged" },
      { name: "CategoryId", type: "string", note: "FK → ProjCategory; expense category (e.g. Travel, Entertainment)" },
      { name: "Worker", type: "int64", note: "FK → HcmWorker; employee who incurred the expense (nullable)" },
      { name: "TransDate", type: "date", note: "Date the expense was posted" },
      { name: "TotalCostAmountCur", type: "decimal", note: "Total cost in transaction currency" },
      { name: "TotalSalesAmountCur", type: "decimal", note: "Billable amount in transaction currency" },
      { name: "VoucherJournal", type: "string", note: "GL voucher number; matches SubledgerVoucherGeneralJournalEntry.Voucher for the posted GL entry" },
    ],
  },

  ProjCategory: {
    name: "ProjCategory",
    description: "Project category — shared lookup that classifies project transactions by type (Hour, Expense, Item, Fee). The combination of category + project group + line property determines which GL accounts are used for cost, WIP, and revenue postings.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/group/projcategory",
    fields: [
      { name: "CategoryId", type: "string", note: "Natural key — category identifier (e.g. 'TRAVEL', 'DEV-HOURS')" },
      { name: "Name", type: "string", note: "Display name of the category" },
      { name: "CategoryGroupId", type: "string", note: "FK → ProjCategoryGroup; groups categories for reporting and posting rules" },
      { name: "CategoryType", type: "int32", note: "Enum (read-only): Hours=1, Expense=2, Item=3, Fee=4 — derived from ProjCategoryGroup" },
      { name: "Active", type: "int32", note: "Flag: 1=Active (available for transaction entry), 0=Inactive" },
      { name: "ProjCategoryEmplOption", type: "int32", note: "Controls worker-category relationship: None, Worker must have category assignment, etc." },
      { name: "TaxItemGroupId", type: "string", note: "Default item sales-tax group applied to transactions in this category" },
    ],
  },

  ProjInvoiceTable: {
    name: "ProjInvoiceTable",
    description: "Project billing contract header (shown as Project contracts in the D365FO UI). Defines payment terms, currency, posting profile, and invoice format for one or more projects. ProjTable.ProjInvoiceProjId is the FK into this table.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/main/projinvoicetable",
    fields: [
      { name: "ProjInvoiceProjId", type: "string", note: "FK → ProjInvoiceTable (billing contract) under which this invoice was created" },
      { name: "CurrencyId", type: "string", note: "Invoice currency" },
      { name: "CashDisc", type: "String", fkTarget: "CashDisc.CashDiscCode", note: "Cash discount terms for the billing contract." },
    ],
  },

  ProjInvoiceTrans: {
    name: "ProjInvoiceTrans",
    description: "Project invoice line — in D365FO, invoice lines are stored in per-type tables (ProjInvoiceEmpl for hours, ProjInvoiceItem for materials, ProjInvoiceCost for expenses, ProjInvoiceRevenue for fees, ProjInvoiceOnAcc for on-account). Each line traces back to the originating subledger transaction (e.g. ProjEmplTrans for hour lines).",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/transaction/projinvoiceitem",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK" },
      { name: "ProjInvoiceId", type: "string", note: "FK → ProjInvoiceJour (the parent posted invoice journal)" },
      { name: "ProjId", type: "string", note: "FK → ProjTable; project the line relates to" },
      { name: "CategoryId", type: "string", note: "FK → ProjCategory; category of the invoiced work" },
      { name: "TransDate", type: "date", note: "Date of the underlying transaction being invoiced" },
      { name: "SalesAmount", type: "decimal", note: "Invoice line amount (sales price × quantity)" },
      { name: "OrigTransId", type: "string", note: "FK → ProjEmplTrans.TransId (or equivalent); traces invoice line to source transaction" },
    ],
  },

  ProjOnAccTrans: {
    name: "ProjOnAccTrans",
    description: "On-account (billing milestone) transaction — a pre-billing record entered against a project contract to capture fixed-amount milestones before actual transactions accrue. Milestone lines are included in invoice proposals and result in on-account invoice lines. Tracks completion status and supports fixed-price progress billing.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/transaction/projonacctrans",
    fields: [
      { name: "RecId", type: "int64", note: "Surrogate PK" },
      { name: "ProjID", type: "string", note: "FK → ProjTable; the project the milestone belongs to" },
      { name: "ActivityNumber", type: "string", note: "FK → smmActivities.ActivityNumber; WBS task the milestone aligns to" },
      { name: "Description", type: "string", note: "Milestone description shown on the invoice" },
      { name: "TotalSalesAmountCur", type: "decimal", note: "Billable amount for this milestone in transaction currency" },
      { name: "TransDate", type: "date", note: "Milestone billing date" },
      { name: "IsMilestoneComplete", type: "int32", note: "Flag: 1=milestone marked complete and ready to invoice" },
      { name: "CurrencyId", type: "string", note: "Currency of the on-account amount" },
    ],
  },

  ProjRevenueTrans: {
    name: "ProjRevenueTrans",
    description: "Accrued revenue transaction — posted by the revenue recognition (estimate) process for fixed-price projects. Each row represents a revenue accrual entry that debits WIP-Revenue and credits Accrued Revenue. Reversed when the project is eventually invoiced or completed. CDM display name is 'Fee in Transaction'.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/transaction/projrevenuetrans",
    fields: [
      { name: "TransId", type: "string", note: "Natural key — unique accrual transaction ID" },
      { name: "ProjId", type: "string", note: "FK → ProjTable; the fixed-price project being recognised" },
      { name: "CategoryId", type: "string", note: "FK → ProjCategory; revenue category driving the posting accounts" },
      { name: "TransDate", type: "date", note: "Date the revenue accrual was recognised" },
      { name: "TotalSalesAmountCur", type: "decimal", note: "Revenue amount accrued in transaction currency" },
      { name: "VoucherJournal", type: "string", note: "GL voucher; matches SubledgerVoucherGeneralJournalEntry.Voucher for the WIP-revenue accounting entry" },
      { name: "IsCorrection", type: "int32", note: "Flag: 1=this row is a reversal/correction of a prior accrual" },
      { name: "LinePropertyId", type: "string", note: "FK → ProjLineProperty; controls whether line is chargeable and accrues revenue" },
    ],
  },

  AssetTable: {
    name: "AssetTable",
    description: "Fixed asset master record — one row per physical or intangible asset. Contains the asset ID, name, group classification, acquisition date, location, and default financial dimensions. All value model (AssetBook) and transaction (AssetTrans) records link back to AssetTable via AssetId.",
    module: "Fixed Assets",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/fixedassets/main/assettable",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "AssetId",
        type: "String",
        note: "Primary key — unique identifier assigned to each fixed asset",
      },
      {
        name: "Name",
        type: "String",
        note: "Descriptive name of the asset",
      },
      {
        name: "AssetGroup",
        type: "String",
        fkTarget: "AssetGroup.GroupId",
        note: "FK to the asset group that governs posting profiles and depreciation defaults",
      },
      {
        name: "AcquisitionDate_W",
        type: "Date",
        note: "Date the asset was acquired (w/o tax)",
      },
      {
        name: "AcquisitionPrice_W",
        type: "Decimal",
        note: "Acquisition price of the asset (without tax)",
      },
      {
        name: "AcquisitionValueNO",
        type: "Decimal",
        note: "Full acquisition value including any additional acquisition costs",
      },
      {
        name: "Location",
        type: "String",
        note: "Physical location of the asset",
      },
      {
        name: "SerialNum",
        type: "String",
        note: "Manufacturer serial number or asset tag",
      },
      {
        name: "DefaultDimension",
        type: "Int64",
        fkTarget: "DimensionAttributeValueSet.RecId",
        note: "FK to the default financial dimension set for this asset",
      },
    ],
  },

  AssetBook: {
    name: "AssetBook",
    description: "Value model (depreciation book) assigned to a fixed asset. One asset can have multiple AssetBook rows (e.g. a tax book and a statutory book). Defines acquisition cost, scrap value, service life, depreciation profile, and holds running depreciation values.",
    module: "Fixed Assets",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/fixedassets/main/assetbook",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "AssetId",
        type: "String",
        fkTarget: "AssetTable.AssetId",
        note: "FK to the asset this book belongs to",
      },
      {
        name: "BookId",
        type: "String",
        note: "Primary key of the value model / depreciation book (e.g. 'Tax', 'Local')",
      },
      {
        name: "AcquisitionDate",
        type: "Date",
        note: "Date the asset was acquired under this book",
      },
      {
        name: "AcquisitionPrice",
        type: "Decimal",
        note: "Acquisition cost recorded in this value model",
      },
      {
        name: "ScrapValue",
        type: "Decimal",
        note: "Residual value at end of useful life (minimum net book value)",
      },
      {
        name: "ServiceLife",
        type: "Decimal",
        note: "Total useful life in years for depreciation calculation",
      },
      {
        name: "DepreciationProfile",
        type: "String",
        fkTarget: "AssetDepreciationProfile.DepreciationProfileId",
        note: "FK to the depreciation profile defining the calculation method",
      },
      {
        name: "DepreciationConvention",
        type: "Int32",
        note: "Enum: 0 = First day, 1 = Last day — determines period boundary for first/last depreciation",
      },
      {
        name: "Status",
        type: "Int32",
        note: "Enum: 0 = Open, 1 = Permanently depreciated, 2 = Disposed",
      },
    ],
  },

  AssetTrans: {
    name: "AssetTrans",
    description: "Individual fixed asset transaction rows — one per acquisition, depreciation run, impairment, revaluation, or disposal event. Linked to the AssetBook (value model) and posts GL entries via LedgerDimension.",
    module: "Fixed Assets",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/fixedassets/transaction/assettrans",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "AssetId",
        type: "String",
        fkTarget: "AssetTable.AssetId",
        note: "FK to the asset that this transaction belongs to",
      },
      {
        name: "BookId",
        type: "String",
        fkTarget: "AssetBook.BookId",
        note: "FK to the value model (book) that this transaction applies to",
      },
      {
        name: "TransType",
        type: "Enum",
        note: "Enum: 1 = Acquisition, 2 = Depreciation, 3 = Disposal, 4 = Revaluation, etc.",
      },
      {
        name: "TransDate",
        type: "Date",
        note: "Date of the transaction",
      },
      {
        name: "AmountCur",
        type: "Decimal",
        note: "Transaction amount in the original currency",
      },
      {
        name: "AmountMST",
        type: "Decimal",
        note: "Transaction amount in the accounting currency",
      },
      {
        name: "CurrencyCode",
        type: "String",
        fkTarget: "Currency.CurrencyCode",
        note: "ISO currency code of the transaction",
      },
      {
        name: "LedgerDimension",
        type: "Int64",
        fkTarget: "DimensionAttributeValueCombination.RecId",
        note: "FK to the GL ledger account and dimensions this transaction posts to",
      },
      {
        name: "Voucher",
        type: "String",
        note: "Voucher number linking to the GeneralJournalEntry",
      },
    ],
  },

  AssetGroup: {
    name: "AssetGroup",
    description: "Asset classification group master. Groups assets by type (Vehicles, Computers, Furniture, etc.) and drives defaults: number sequence for asset IDs, capitalisation threshold, default depreciation profile, and posting accounts for acquisitions and depreciation.",
    module: "Fixed Assets",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/fixedassets/group/assetgroup",
    fields: [
      {
        name: "RecId",
        type: "Int64",
        note: "Surrogate primary key",
      },
      {
        name: "GroupId",
        type: "String",
        note: "Primary key — unique code identifying the asset group (e.g. 'EQ-VEHICLE')",
      },
      {
        name: "Name",
        type: "String",
        note: "Human-readable name of the asset group",
      },
      {
        name: "AssetType",
        type: "Int32",
        note: "Enum classifying asset type (Tangible, Intangible, Financial)",
      },
      {
        name: "CapitalizationThreshold",
        type: "Decimal",
        note: "Minimum cost above which an item must be capitalised as a fixed asset",
      },
      {
        name: "Location",
        type: "String",
        note: "Default location assigned to assets in this group",
      },
      {
        name: "MajorType",
        type: "String",
        note: "Major type classification for reporting purposes",
      },
    ],
  },

  AgreementHeader: {
    name: "AgreementHeader",
    description: "Purchase and sales agreement (blanket order) header — the shared agreement framework header storing the classification, currency, validity window, and state of every agreement, whether it is a purchase agreement or a sales agreement. AgreementLine holds the committed quantities and prices beneath it.",
    module: "Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/procurementandsourcing/worksheetheader/agreementheader",
    fields: [
      { name: "AgreementClassification", type: "Int64", fkTarget: "AgreementClassification.RecId", note: "Agreement classification (purchase agreement, sales agreement, etc.) that determines which lines and defaults apply." },
      { name: "Currency", type: "String", fkTarget: "Currency.CurrencyCode", note: "Currency for the agreement amounts; inherited by releases created against it." },
      { name: "DefaultDimension", type: "Int64", fkTarget: "DimensionAttributeValueSet.RecId", note: "Default financial dimension set applied to releases when the line has no explicit dimensions." },
      { name: "Language", type: "String", fkTarget: "LanguageTable.LanguageId", note: "Document language used for agreement printouts." },
      { name: "Originator", type: "Int64", fkTarget: "DirPerson.RecId", note: "Person who originated the agreement (inside contact)." },
      { name: "AgreementState", type: "Enum", note: "Lifecycle state: Draft / Effective / On hold / Expired / Closed — releases are only allowed while Effective." },
      { name: "EarliestLineEffectiveDate", type: "Date", note: "Earliest effective date across all child lines; drives the agreement validity window shown in the UI." },
      { name: "LatestLineExpirationDate", type: "Date", note: "Latest expiration date across all child lines." },
    ],
  },

  AgreementLine: {
    name: "AgreementLine",
    description: "Agreement line — the committed quantity and price for one item, category, or project on an agreement header. Sales and purchase orders released against the agreement consume the committed amount and cannot exceed it when the max-enforced flag is set.",
    module: "Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/procurementandsourcing/worksheetline/agreementline",
    fields: [
      { name: "Agreement", type: "Int64", fkTarget: "AgreementHeader.RecId", note: "Parent agreement header this line belongs to." },
      { name: "EffectiveDate", type: "Date", note: "Date the line becomes valid; releases before this date are rejected." },
      { name: "ExpirationDate", type: "Date", note: "Date the line stops being valid." },
      { name: "Category", type: "Int64", fkTarget: "EcoResCategory.RecId", note: "Procurement/sales category when the line is category-based rather than item-based." },
      { name: "Currency", type: "String", fkTarget: "Currency.CurrencyCode", note: "Line currency; normally inherited from the header." },
      { name: "InventDimId", type: "String", fkTarget: "InventDim.inventDimId", note: "Inventory dimension combination the commitment is restricted to (e.g. a specific site/warehouse)." },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Committed item; mutually exclusive with Category depending on AgreementLineProduct." },
      { name: "ProjectProjId", type: "String", fkTarget: "ProjTable.ProjId", note: "Project the agreement line is tied to, for project purchase/sales agreements." },
    ],
  },

  ForecastSales: {
    name: "ForecastSales",
    description: "Sales forecast (demand forecast) entry — one row per item/project forecast by model, period, and quantity. Master planning consumes these rows as independent demand so that planned orders cover forecast demand as well as actual sales orders. CDM display name: 'Sales forecast'.",
    module: "Master Planning",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/masterplanning/worksheetline/forecastsales",
    fields: [
      { name: "Currency", type: "String", fkTarget: "Currency.CurrencyCode", note: "Currency of the forecasted sales amount." },
      { name: "ModelId", type: "String", fkTarget: "ForecastModel.ModelId", note: "Forecast model the entry belongs to; master plans reference one or more models for demand reduction." },
      { name: "StartDate", type: "Date", note: "Start of the forecast bucket; combined with Freq/FreqCode to derive the requirement date." },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Forecasted item; null for pure project-fee forecasts." },
      { name: "CustAccountId", type: "String", fkTarget: "CustTable.AccountNum", note: "Customer the forecasted demand is attributed to, when known." },
      { name: "ProjId", type: "String", fkTarget: "ProjTable.ProjId", note: "Project the forecast is booked against, for project demand forecasting." },
      { name: "InventDimId", type: "String", fkTarget: "InventDim.inventDimId", note: "Inventory dimensions (site/warehouse) the forecasted demand is planned for." },
      { name: "SalesQty", type: "Real", note: "Forecasted sales quantity in SalesUnitId for the bucket." },
    ],
  },

  InventCostList: {
    name: "InventCostList",
    description: "Inventory cost calculation work list — transient rows the inventory closing and recalculation process writes while it walks the BOM levels for one voucher. Each row records the item, BOM level, and iteration the cost run is currently at; rows are consumed and cleared as the run progresses.",
    module: "Inventory Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/transactionline/inventcostlist",
    fields: [
      { name: "Voucher", type: "String", note: "Voucher of the inventory closing/recalculation run this work-list row belongs to." },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Item whose cost is being calculated." },
      { name: "Bundle", type: "Int64", fkTarget: "InventCostBundleList.RecId", note: "Cost bundle the row was grouped into for parallel processing." },
      { name: "InventCostListItemStatus", type: "Enum", note: "Processing status of the row (not started / in progress / done)." },
      { name: "BOMLevel", type: "Int", note: "BOM explosion level being costed — low-level items are costed before their parents." },
      { name: "NumOfIteration", type: "Int", note: "Iteration counter for items that require repeated costing passes." },
      { name: "StartDateTime", type: "UtcDateTime", note: "Timestamp the row started processing." },
      { name: "EndDateTime", type: "UtcDateTime", note: "Timestamp the row finished processing." },
    ],
  },

  LedgerConsolidateHist: {
    name: "LedgerConsolidateHist",
    description: "General ledger consolidation history — one row per consolidation run performed for a legal entity, recording the template used, the date range consolidated, the originating company, and whether the result was reviewed or reversed. LedgerConsolidateHistRef links each run to the consolidation transactions it produced.",
    module: "General Ledger / Consolidations",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/financial-consolidations-currency-translation",
    fields: [
      { name: "ConsolidateTemplate", type: "Int64", fkTarget: "LedgerConsolidateTemplate.RecId", note: "Consolidation template that defined the accounts, ranges, and options used for this run." },
      { name: "CompanyIdOrigin", type: "String", fkTarget: "DataArea.id", note: "Source legal entity whose transactions were consolidated into the current company." },
      { name: "BatchJobId", type: "Int64", fkTarget: "BatchJob.RecId", note: "Batch job that executed the consolidation, when run in batch." },
      { name: "Description", type: "String", note: "Free-text description of the consolidation run." },
      { name: "FromDate", type: "Date", note: "Start of the transaction date range that was consolidated." },
      { name: "ToDate", type: "Date", note: "End of the transaction date range that was consolidated." },
      { name: "ProcessDateTime", type: "UtcDateTime", note: "When the consolidation was processed." },
      { name: "Reviewed", type: "Enum", note: "Whether a reviewer has signed off the run; once reviewed, Notes can no longer be edited." },
    ],
  },

  LedgerConsolidateTemplate: {
    name: "LedgerConsolidateTemplate",
    description: "Consolidation template — defines one reusable set of consolidation options: which account range and amount source to take from the source company, the target account range, the exchange-rate type for currency translation, and whether budget or actual balances are transferred.",
    module: "General Ledger / Consolidations",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/financial-consolidations-currency-translation",
    fields: [
      { name: "Name", type: "String", note: "Template identifier selected when a consolidation is run." },
      { name: "BudgetExchangeRateType", type: "Int64", fkTarget: "ExchangeRateType.RecId", note: "Exchange-rate type used to translate budget balances when TransferBudget is enabled." },
      { name: "ConsolidateAccountGroup", type: "Int64", fkTarget: "LedgerConsolidateAccountGroup.RecId", note: "Consolidation account group used to map source accounts to target accounts." },
      { name: "Description", type: "String", note: "Human-readable description of what the template does." },
      { name: "ConsolidateAccountSource", type: "Enum", note: "Selects whether accounts come from the consolidation account group or directly from the source accounts." },
      { name: "ProcessMode", type: "Enum", note: "Whether to transfer transactions (detailed) or only balances (summarised) during consolidation." },
      { name: "FromAccount", type: "String", fkTarget: "MainAccount.MainAccountId", note: "Start of the main account range to consolidate from the source company." },
      { name: "ToAccount", type: "String", fkTarget: "MainAccount.MainAccountId", note: "End of the main account range to consolidate from the source company." },
    ],
  },

  MarkupAutoTable: {
    name: "MarkupAutoTable",
    description: "Automatic charges setup — one row per rule that tells the system to add a charge line (markup) automatically to a purchase or sales order header/line. Each rule is a polymorphic combination: an account code/relation (customer, vendor, or group), an item code/relation (item, item group, or all), a delivery-mode code/relation, and an optional channel, matched by module type. CDM display name: 'Auto charges'.",
    module: "Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/procurementandsourcing/group/markupautotable",
    fields: [
      { name: "AccountCode", type: "Enum", note: "Granularity of the account match: All / Table (one account) / Group / Payer." },
      { name: "AccountRelation", type: "String", fkTarget: "CustTable.AccountNum", note: "The account matched by AccountCode — a customer/vendor account or a group id, depending on the code." },
      { name: "ItemCode", type: "Enum", note: "Granularity of the item match: All / Table (one item) / Group / Category." },
      { name: "ItemRelation", type: "String", fkTarget: "InventTable.ItemId", note: "The item matched by ItemCode — an item id, item group, or category id." },
      { name: "DlvModeCode", type: "Enum", note: "Granularity of the delivery-mode match: All / Table / Group." },
      { name: "DlvModeRelation", type: "String", fkTarget: "DlvMode.Code", note: "The delivery mode or delivery-mode group this rule applies to." },
      { name: "ModuleType", type: "Enum", note: "Where the rule fires: Sales order / Purchase order / Project / Service order / Return order." },
      { name: "ModuleCategory", type: "Enum", note: "Whether the charge lands on the order header or on each order line." },
    ],
  },

  ProjInvoiceJour: {
    name: "ProjInvoiceJour",
    description: "Posted project invoice journal — the posted customer invoice header for project billing, holding invoice totals, tax, currency and exchange rate, payment terms, and the print/electronic-invoice state. One row per posted project invoice; ProjInvoiceTrans and the per-type line tables (ProjInvoiceEmpl/Item/Cost/Revenue/OnAcc) link back to it by ProjInvoiceId.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/transaction/projinvoicejour",
    fields: [
      { name: "InvoiceDate", type: "Date", note: "Invoice document date used for posting and aging." },
      { name: "ProjInvoiceId", type: "String", note: "Primary key — posted project invoice number from the number sequence." },
      { name: "InvoiceAccount", type: "String", fkTarget: "CustTable.AccountNum", note: "Customer account that is invoiced; may differ from the order account in third-party billing." },
      { name: "OrderAccount", type: "String", fkTarget: "CustTable.AccountNum", note: "Customer account the work was ordered by." },
      { name: "CurrencyId", type: "String", fkTarget: "Currency.CurrencyCode", note: "Invoice transaction currency." },
      { name: "ProjInvoiceProjId", type: "String", fkTarget: "ProjInvoiceTable.ProjInvoiceProjId", note: "Billing contract (project contract) the invoice was issued under." },
      { name: "ProposalId", type: "String", fkTarget: "ProjProposalJour.ProposalId", note: "Invoice proposal the posted invoice was created from." },
      { name: "InvoiceAmount", type: "Real", note: "Invoice total in the transaction currency, excluding the rounding-off adjustment." },
    ],
  },

  ReqPlanVersion: {
    name: "ReqPlanVersion",
    description: "Master plan version — identifies one versioned snapshot of a master plan's output. Master planning writes ReqTrans rows tagged with the version, letting planners compare scenarios and firm planned orders from a specific version. CDM display name: 'Master plan versions'.",
    module: "Master Planning",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/coverage-settings",
    fields: [
      { name: "Active", type: "Enum", note: "Whether this plan version is the active one used as the default view for net requirements." },
      { name: "ReqPlanDataAreaId", type: "String", fkTarget: "ReqPlan.dataAreaId", note: "Legal entity the plan version belongs to." },
      { name: "ReqPlanId", type: "String", note: "Master plan the version was generated by." },
      { name: "LastCostCalculationDateTime", type: "UtcDateTime", note: "When costing was last calculated for this version." },
      { name: "SysRowVersionNumber", type: "Int64", note: "Internal row-version token used for optimistic concurrency." },
    ],
  },

  ResResourceIdentifier: {
    name: "ResResourceIdentifier",
    description: "Resource identifier — maps a project/operations resource to the record it represents via a generic (RefTableId, RefRecId) pair. A resource can point at a worker (HcmWorker), a machine or work centre (WrkCtrTable), or another resource table; this indirection is what lets one resource pool mix people and equipment.",
    module: "Project Management and Accounting",
    fields: [
      { name: "RefRecId", type: "Int64", note: "Surrogate key of the underlying record the resource stands for; which table it points at is decided by RefTableId, so it must not be narrowed to one target." },
      { name: "RefTableId", type: "Int", note: "Table id of the underlying record; together with RefRecId forms the polymorphic resource pointer." },
    ],
  },

  SMADispatchWorkerSetup: {
    name: "SMADispatchWorkerSetup",
    description: "Dispatch worker setup — assigns a worker to a dispatch team inside a company. This is the worker↔team bridge the dispatch board reads when it lists the technicians available for a team's service activities; the team's owner sits on SMADispatchTeamTable.",
    module: "Service Management",
    fields: [
      { name: "RecId", type: "Int64", note: "PK – surrogate key" },
      { name: "DispatchTeamDataAreaId", type: "String", note: "Company (legal entity) the assignment belongs to; part of the alternate key with DispatchTeamId and Worker." },
      { name: "DispatchTeamId", type: "String", fkTarget: "SMADispatchTeamTable.DispatchTeamId", note: "FK → SMADispatchTeamTable.DispatchTeamId – team the worker belongs to." },
      { name: "Worker", type: "Int64", fkTarget: "HcmWorker.RecId", note: "FK → HcmWorker – worker assigned to the dispatch team." },
    ],
  },

  SMADispatchTeamTable: {
    name: "SMADispatchTeamTable",
    description: "Service dispatch team — a named team of service technicians used by the dispatch board to assign service activities. The team has an owner (the responsible worker) and members defined in the related dispatch team member table.",
    module: "Service Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/servicemanagement/group/smadispatchteamtable",
    fields: [
      { name: "DispatchTeamId", type: "String", note: "Primary key — team identifier shown on the dispatch board." },
      { name: "WorkerOwner", type: "Int64", fkTarget: "HcmWorker.RecId", note: "Worker who owns the team and is responsible for its activities." },
      { name: "Description", type: "String", note: "Free-text description of the team's purpose or coverage area." },
    ],
  },

  WHSCycleCountPlan: {
    name: "WHSCycleCountPlan",
    description: "Warehouse cycle count plan — a recurring instruction to count the on-hand inventory that matches a location query and an item query, on the schedule defined by DaysBetween, creating cycle count work when it runs. The plan names the work pool and work template used to generate the counting work.",
    module: "Warehouse Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/main/whscyclecountplan",
    fields: [
      { name: "CycleCountPlanId", type: "String", note: "Primary key — cycle count plan identifier." },
      { name: "WorkPoolId", type: "String", fkTarget: "WHSWorkPool.WorkPoolId", note: "Work pool that counting work generated by this plan is assigned to." },
      { name: "WorkTemplateCode", type: "String", fkTarget: "WHSWorkTemplateTable.WorkTemplateCode", note: "Work template controlling the counting work's steps and directives." },
      { name: "Description", type: "String", note: "Free-text description of the plan." },
      { name: "DaysBetween", type: "Int", note: "Number of days between successive count runs." },
      { name: "MaxCounts", type: "Int", note: "Maximum number of counting lines the plan may generate per run — caps the workload." },
      { name: "ItemQuery", type: "Container", note: "Packed query selecting which items the plan counts." },
      { name: "LocationQuery", type: "Container", note: "Packed query selecting which locations the plan counts." },
    ],
  },

  WHSWorkLineCycleCount: {
    name: "WHSWorkLineCycleCount",
    description: "Cycle count work line — the counting instruction for one item/location/license-plate combination on a warehouse cycle count work order. Holds the expected quantity, the quantity the worker counted, and the reconciliation flag indicating whether the count matched or triggered an adjustment.",
    module: "Warehouse Management",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/worksheetline/whsworklinecyclecount",
    fields: [
      { name: "InventDimId", type: "String", fkTarget: "InventDim.inventDimId", note: "Inventory dimensions (location, license plate, status) being counted." },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Item being counted at this location." },
      { name: "LineNum", type: "Real", fkTarget: "WHSWorkLine.LineNum", note: "Line number within the parent counting work order." },
      { name: "WorkId", type: "String", fkTarget: "WHSWorkTable.WorkId", note: "Parent cycle count work order." },
      { name: "QtyCounted", type: "Real", note: "Quantity the worker physically counted." },
      { name: "QtyExpected", type: "Real", note: "On-hand quantity the system expected at the location." },
      { name: "CountingReasonCode", type: "String", fkTarget: "InventCountingReasonCode.ReasonCode", note: "Reason code explaining why an adjustment was accepted." },
      { name: "CycleCountCounted", type: "Enum", note: "Whether the line has already been counted." },
    ],
  },

  SysTableIdTable: {
    name: "SysTableIdTable",
    description: "System table id lookup — maps every table's numeric table id to its table name. Reflects the application's table-id allocation and is used by the generic reference framework (RefTableId) to resolve which table a RecId belongs to.",
    module: "System Administration – Security",
    fields: [
      { name: "Id", type: "Int", note: "Numeric table id assigned at compile time; the value stored in RefTableId columns." },
      { name: "Name", type: "String", note: "Table name that the numeric id resolves to." },
    ],
  },

  AgreementHeaderDefaultHistory: {
    name: "AgreementHeaderDefaultHistory",
    description: "AgreementHeaderDefaultHistory — TransactionHeader table in the ProcurementAndSourcing module. (label @SYS190138). Replaces AgreementHeaderHistoryIdx in newer deployments. 21 fields, 10 AOT relations.",
    module: "Procurement and Sourcing",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/procurementandsourcing/transactionheader/agreementheaderdefaulthistory",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key; not exposed by the CDM field list but present on every table" },
      { name: "AgreementHeaderHistory", type: "Int64", fkTarget: "AgreementHeaderHistory.RecId", note: "EDT RefRecId; label @SYS190138" },
      { name: "CashDiscountCode", type: "String", fkTarget: "CashDisc.CashDiscCode", note: "EDT CashDiscCode" },
      { name: "CashDiscountDataAreaId", type: "String", fkTarget: "CashDisc.dataAreaId", note: "EDT DataAreaId" },
      { name: "ContactPerson", type: "String", fkTarget: "ContactPerson.ContactPersonId", note: "EDT ContactPersonId" },
      { name: "ContactPersonDataAreaId", type: "String", fkTarget: "ContactPerson.dataAreaId", note: "EDT DataAreaId" },
      { name: "DeliveryMode", type: "String", fkTarget: "DlvMode.Code", note: "EDT DlvModeId" },
      { name: "DeliveryModeDataAreaId", type: "String", fkTarget: "DlvMode.dataAreaId", note: "EDT DataAreaId" },
      { name: "DeliveryName", type: "String", note: "EDT LogisticsDeliveryName" },
      { name: "DeliveryPostalAddress", type: "Int64", fkTarget: "LogisticsPostalAddress.RecId", note: "EDT LogisticsPostalAddressRecId" },
      { name: "DeliveryTerm", type: "String", fkTarget: "DlvTerm.Code", note: "EDT DlvTermId" },
      { name: "DeliveryTermDataAreaId", type: "String", fkTarget: "DlvTerm.dataAreaId", note: "EDT DataAreaId" },
      { name: "ExternalReference", type: "String", note: "EDT PersonName; label @SYS21697" },
      { name: "MiscChargeGroup", type: "String", fkTarget: "MarkupGroup.GroupId", note: "EDT MarkupGroupId" },
      { name: "MiscChargeGroupApplicationModule", type: "Enum", fkTarget: "MarkupGroup.Module", note: "EDT MarkupModule; enum MarkupModuleType" },
      { name: "MiscChargeGroupDataAreaId", type: "String", fkTarget: "MarkupGroup.dataAreaId", note: "EDT DataAreaId" },
      { name: "PaymentSchedule", type: "String", fkTarget: "PaymSched.Name", note: "EDT PaymSchedId" },
      { name: "PaymentScheduleDataAreaId", type: "String", fkTarget: "PaymSched.dataAreaId", note: "EDT DataAreaId" },
      { name: "PaymentTerms", type: "String", fkTarget: "PaymTerm.PaymTermId", note: "EDT PaymTermId" },
      { name: "PaymentTermsDataAreaId", type: "String", fkTarget: "PaymTerm.dataAreaId", note: "EDT DataAreaId" },
      { name: "Project", type: "String", fkTarget: "ProjTable.ProjId", note: "EDT ProjId" },
      { name: "ProjectDataAreaId", type: "String", fkTarget: "ProjTable.dataAreaId", note: "EDT DataAreaId" },
    ],
  },

  BOM: {
    name: "BOM",
    description: "BOM — BOM lines. Main table in the ProductInformationManagement module; replaces BOMCreationSequenceIdx in newer deployments. 47 fields, 9 AOT relations.",
    module: "Product Information Management",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productinformationmanagement/main/bom",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key; not exposed by the CDM field list but present on every table" },
      { name: "BOMConsump", type: "Enum", note: "enum BOMConsumpType" },
      { name: "BOMId", type: "String", fkTarget: "BOMTable.BOMId", note: "EDT BOMId" },
      { name: "BOMQty", type: "Real", note: "EDT BOMQty" },
      { name: "BOMQtySerie", type: "Real", note: "EDT BOMQtySerie" },
      { name: "BOMType", type: "Enum", note: "enum BOMType" },
      { name: "BomWHSReleasePolicy", type: "Enum", note: "enum BomWHSReleasePolicy" },
      { name: "Calculation", type: "Enum", note: "enum NoYes; EDT BOMCalcBOMLine" },
      { name: "ConfigGroupId", type: "String", fkTarget: "ConfigGroup.ConfigGroupId", note: "EDT ConfigGroupId" },
      { name: "Constant", type: "Real", note: "EDT BOMMeasureConstant" },
      { name: "Density", type: "Real", note: "EDT BOMMeasureDensity" },
      { name: "Depth", type: "Real", note: "EDT BOMMeasureDepth" },
      { name: "EndSchedConsump", type: "Enum", note: "enum NoYes; EDT BOMEndSchedConsump" },
      { name: "Formula", type: "Enum", note: "enum BOMFormula" },
      { name: "FromDate", type: "Date", note: "From date; EDT StartDate" },
      { name: "Height", type: "Real", note: "EDT BOMMeasureHeight" },
      { name: "InventDimId", type: "String", fkTarget: "InventDim.inventDimId", note: "EDT InventDimId" },
      { name: "ItemBOMId", type: "String", fkTarget: "BOMTable.BOMId", note: "EDT ItemBOMId" },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "EDT ItemIdInventoried; mandatory" },
      { name: "ItemRouteId", type: "String", fkTarget: "RouteTable.RouteId", note: "EDT ItemRouteId" },
      { name: "LineCreationSequenceNumber", type: "Int", note: "EDT BOMLineCreationSequenceNumber" },
      { name: "LineNum", type: "Real", note: "EDT LineNum" },
      { name: "MaterialOverpickPercentage", type: "Real", note: "EDT WHSMaterialOverpickPercentage" },
      { name: "OprNum", type: "Int", note: "EDT OprNumBOMLine" },
      { name: "PDSBaseValue", type: "String", note: "EDT PDSBaseValue" },
      { name: "PDSIngredientType", type: "Enum", note: "enum PDSIngredientTypeEnum; EDT PDSIngredientType" },
      { name: "PDSInheritCoProductBatchAttrib", type: "Enum", note: "Inherit batch attributes to co-products; enum NoYes; EDT PDSInheritBatchAttrib" },
      { name: "PDSInheritCoProductShelfLife", type: "Enum", note: "Inherit shelf life dates to co-products; enum NoYes; EDT PDSInheritShelfLife" },
      { name: "PDSInheritEndItemBatchAttrib", type: "Enum", note: "Inherit batch attributes to end item; enum NoYes; EDT PDSInheritBatchAttrib" },
      { name: "PDSInheritEndItemShelfLife", type: "Enum", note: "Inherit shelf life dates to end item; enum NoYes; EDT PDSInheritShelfLife" },
      { name: "PdsCWQty", type: "Real", note: "EDT PdsCWInventQty" },
      { name: "PmfFormulaPct", type: "Real", note: "EDT PmfFormulaPct" },
      { name: "PmfPctEnable", type: "Enum", note: "Percent controlled; enum NoYes; EDT NoYesId" },
      { name: "PmfPlanGroupId", type: "String", fkTarget: "PmfPlanGroup.PmfPlanGroupId", note: "EDT ReqPlanGroupIdBase" },
      { name: "PmfPlanGroupPriority", type: "Int", note: "EDT ReqPlanGroupPriorityBase" },
      { name: "PmfScalable", type: "Enum", note: "Scalable; enum NoYes; EDT NoYesId" },
      { name: "Position", type: "String", note: "EDT BOMPosition" },
      { name: "ProdFlushingPrincip", type: "Enum", note: "enum ProdFlushingPrincipBOM" },
      { name: "ProjSetSubProdToConsumed", type: "Enum", note: "enum NoYes; EDT ProjSetSubProdToConsumed" },
      { name: "RoundUp", type: "Enum", note: "enum BOMRoundUp" },
      { name: "RoundUpQty", type: "Real", note: "EDT BOMRoundUpQty" },
      { name: "ScrapConst", type: "Real", note: "EDT ScrapConst" },
      { name: "ScrapVar", type: "Real", note: "EDT ScrapVar" },
      { name: "ToDate", type: "Date", note: "To date; EDT EndDate" },
      { name: "UnitId", type: "String", fkTarget: "UnitOfMeasure.Symbol", note: "EDT UnitOfMeasureSymbol; mandatory" },
      { name: "VendId", type: "String", fkTarget: "VendTable.AccountNum", note: "EDT VendAccount" },
      { name: "Width", type: "Real", note: "EDT BOMMeasureWidth" },
      { name: "WrkCtrConsumption", type: "Enum", note: "enum boolean; EDT WrkCtrConsumption" },
    ],
  },

  RouteVersion: {
    name: "RouteVersion",
    description: "Production route version that assigns a route to an item for a validity and quantity range, with approval and activation status.",
    module: "Production",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productioncontrol/main/routeversion",
    fields: [
      { name: "RecId", type: "Int64", note: "" },
      { name: "Active", type: "Enum", note: "EDT RouteVersionActive; enum NoYes." },
      { name: "Approved", type: "Enum", note: "EDT RouteVersionApproved; enum NoYes." },
      { name: "Approver", type: "Int64", note: "EDT BOMRouteApprover." },
      { name: "Construction", type: "Enum", note: "EDT BOMRouteVersionConstruction; enum NoYes." },
      { name: "FromDate", type: "Date", note: "EDT FromDate." },
      { name: "FromQty", type: "Real", note: "EDT ProductFromQuantity." },
      { name: "InventDimId", type: "String", note: "EDT InventDimId." },
      { name: "ItemId", type: "String", note: "EDT ItemIdProduction." },
      { name: "Name", type: "String", note: "EDT Name." },
      { name: "RouteId", type: "String", note: "EDT RouteId." },
      { name: "ToDate", type: "Date", note: "EDT ToDate." },
    ],
  },
  ProdJournalRoute: {
    name: "ProdJournalRoute",
    description: "Route-card production journal line recording reported operation time, quantities, completion, worker, and work center for a production order.",
    module: "Production",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/productioncontrol/worksheetline/prodjournalroute",
    fields: [
      { name: "RecId", type: "Int64", note: "" },
      { name: "Cancelled", type: "Enum", note: "EDT Cancelled; enum NoYes." },
      { name: "CategoryHoursId", type: "String", note: "EDT RouteCostCategoryId." },
      { name: "CategoryQtyId", type: "String", note: "EDT RouteCostCategoryId." },
      { name: "DefaultDimension", type: "Int64", note: "EDT InventSiteLinkedDimensionValueSet." },
      { name: "ErrorCause", type: "Enum", note: "Enum ProdErrorCause." },
      { name: "ExecutedPct", type: "Real", note: "EDT ProdExecutedPct." },
      { name: "FinTag", type: "Int64", note: "EDT FinTagRecId." },
      { name: "FromTime", type: "int32", note: "EDT SchedFromTime; time of day." },
      { name: "HourPrice", type: "Real", note: "EDT ProdHourPrice." },
      { name: "Hours", type: "Real", note: "EDT ProdReportedHours." },
      { name: "JobFinished", type: "Enum", note: "EDT ProdFinishedJob; enum NoYes." },
      { name: "JobId", type: "String", note: "EDT ProdJobId." },
      { name: "JobType", type: "Enum", note: "Enum RouteJobType." },
      { name: "JournalId", type: "String", note: "EDT ProdJournalIdRoute." },
      { name: "LineNum", type: "Real", note: "EDT LineNum." },
      { name: "OprFinished", type: "Enum", note: "EDT ProdFinishedOpr; enum NoYes." },
      { name: "OprId", type: "String", note: "EDT RouteOprId." },
      { name: "OprNum", type: "Int", note: "EDT OprNum." },
      { name: "OprPriority", type: "Enum", note: "Enum RouteOprPriority." },
      { name: "PdsCWQtyError", type: "Real", note: "EDT PdsCWBatchErr." },
      { name: "PdsCWQtyGood", type: "Real", note: "EDT PdsCWBatchGood." },
      { name: "ProdId", type: "String", note: "EDT ProdId." },
      { name: "ProdInventDimId", type: "String", note: "EDT InventDimId." },
      { name: "ProdPickList", type: "Enum", note: "EDT ProdRouteAutoPickList; enum NoYes." },
      { name: "ProdPickListJournalId", type: "String", note: "EDT ProdJournalIdBOM." },
      { name: "ProdReportFinished", type: "Enum", note: "EDT ProdAutoReportFinished; enum NoYes." },
      { name: "ProdReportFinishedJournalId", type: "String", note: "EDT ProdJournalIdProd." },
      { name: "QtyError", type: "Real", note: "EDT ProdReportedError." },
      { name: "QtyGood", type: "Real", note: "EDT ProdReportedGood." },
      { name: "QtyPrice", type: "Real", note: "EDT ProdQtyPrice." },
      { name: "ReleaseKindId_RU", type: "String", note: "EDT ProdReleaseRejectKindId_RU." },
      { name: "StornoPhysical_RU", type: "Enum", note: "EDT Storno_RU; enum NoYes." },
      { name: "ToTime", type: "int32", note: "EDT SchedToTime; time of day." },
      { name: "TransDate", type: "Date", note: "EDT JournalTransDate." },
      { name: "Voucher", type: "String", note: "EDT Voucher." },
      { name: "Worker", type: "Int64", note: "EDT ProdWorker." },
      { name: "WrkCtrId", type: "String", note: "EDT WrkCtrIdBase." },
    ],
  },
  InventClosing: {
    name: "InventClosing",
    description: "Inventory close run record containing its execution date, voucher, status, parameters, and cancellation or recalculation state.",
    module: "Inventory",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/inventory/transactionheader/inventclosing",
    fields: [
      { name: "RecId", type: "Int64", note: "" },
      { name: "Active", type: "Enum", note: "Enum NoYes." },
      { name: "AdjustmentSpec", type: "Enum", note: "Enum InventAdjustmentSpec." },
      { name: "AdjustmentType", type: "Enum", note: "Enum InventAdjustmentType." },
      { name: "BOMLevel", type: "Int", note: "EDT ItemBOMLevel." },
      { name: "CancelClosingRefRecId", type: "Int64", note: "EDT InventClosingRefRecId." },
      { name: "CancelRecalculation", type: "Enum", note: "EDT InventCostCancelRecalculation; enum NoYes." },
      { name: "Cancellation", type: "Enum", note: "Enum NoYes." },
      { name: "End", type: "int32", note: "EDT ToTime; time of day." },
      { name: "Executed", type: "Date", note: "EDT TransDate." },
      { name: "HelpersCreated", type: "Enum", note: "EDT NoYesId; enum NoYes." },
      { name: "InventCostStatus", type: "Enum", note: "Enum InventCostStatus." },
      { name: "InventSumDateFinancialCalcFinished_RU", type: "Enum", note: "EDT NoYesId; enum NoYes." },
      { name: "InventTransCurrency_RU", type: "Enum", note: "Enum InventTransCurrency_RU." },
      { name: "Ledger", type: "Enum", note: "Enum NoYes." },
      { name: "LedgerCorrection", type: "Enum", note: "EDT LedgerCorrection; enum NoYes." },
      { name: "LedgerPostingBatch", type: "Int64", note: "EDT RefRecId." },
      { name: "MaxIterations", type: "Int", note: "EDT Integer." },
      { name: "MinTransferValue", type: "Real", note: "EDT CostAmount." },
      { name: "NextRunNum", type: "Int", note: "EDT InventClosingRunNum." },
      { name: "Notes", type: "String", note: "EDT FreeTxt." },
      { name: "NumOfIteration", type: "Int", note: "EDT NumOfIteration." },
      { name: "PeriodCode", type: "String", note: "EDT DateCode." },
      { name: "ProdJournal", type: "Enum", note: "Enum NoYes." },
      { name: "RunNum", type: "Int", note: "EDT InventClosingRunNum." },
      { name: "RunRecalculation", type: "Enum", note: "EDT InventCostRunRecalculation; enum NoYes." },
      { name: "ShouldSummarizeInfolog", type: "Enum", note: "Enum NoYes." },
      { name: "Start", type: "int32", note: "EDT FromTime; time of day." },
      { name: "StopOnError", type: "Enum", note: "EDT NoYesId; enum NoYes." },
      { name: "StopRunning", type: "Enum", note: "EDT NoYesId; enum NoYes." },
      { name: "StornoAdjustment_RU", type: "Enum", note: "Enum UnknownNoYes." },
      { name: "TransDate", type: "Date", note: "EDT TransDate." },
      { name: "Voucher", type: "String", note: "EDT Voucher." },
    ],
  },
  ForecastModel: {
    name: "ForecastModel",
    description: "Forecast model header that identifies a demand forecast model and its related project budget behavior and submodel.",
    module: "Master Planning",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/masterplanning/group/forecastmodel",
    fields: [
      { name: "RecId", type: "Int64", note: "" },
      { name: "Blocked", type: "Enum", note: "Enum NoYes." },
      { name: "Cov", type: "Enum", note: "EDT LedgerAppropriation; enum NoYes." },
      { name: "ModelId", type: "String", note: "EDT ForecastModelId." },
      { name: "ProjBudgetType", type: "Enum", note: "Enum ProjBudgetType." },
      { name: "ProjCheckExpenseBudget", type: "Enum", note: "EDT NoYesId; enum NoYes." },
      { name: "ProjCheckHourBudget", type: "Enum", note: "EDT NoYesId; enum NoYes." },
      { name: "ProjCheckItemBudget", type: "Enum", note: "EDT NoYesId; enum NoYes." },
      { name: "ProjExpenseReduction", type: "Enum", note: "EDT NoYesId; enum NoYes." },
      { name: "ProjForecastWIPFixedPrice", type: "Enum", note: "EDT ProjForecastWIPFixedPrice; enum NoYes." },
      { name: "ProjForecastWIPInvestment", type: "Enum", note: "EDT ProjForecastWIPInvestment; enum NoYes." },
      { name: "ProjForecastWIPTimeMaterial", type: "Enum", note: "EDT ProjForecastWIPTimeMaterial; enum NoYes." },
      { name: "ProjHourReduction", type: "Enum", note: "EDT NoYesId; enum NoYes." },
      { name: "ProjItemReduction", type: "Enum", note: "EDT NoYesId; enum NoYes." },
      { name: "SubModelId", type: "String", note: "EDT ForecastModelSubId." },
      { name: "Txt", type: "String", note: "EDT ForecastName." },
      { name: "Type", type: "Enum", note: "Enum HeadingSub." },
      { name: "UseProjectDate", type: "Enum", note: "EDT NoYesId; enum NoYes." },
    ],
  },
  ReqPlan: {
    name: "ReqPlan",
    description: "Master plan header defining the plan identity, type, forecast model, and whether forecast demand or supply is included.",
    module: "Master Planning",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/masterplanning/group/reqplan",
    fields: [
      { name: "RecId", type: "Int64", note: "" },
      { name: "ForecastModelId", type: "String", note: "EDT ForecastModelHeadId." },
      { name: "ForecastReduceType", type: "Enum", note: "Enum ReqReduceType." },
      { name: "MCRReqPlanIdContinuity", type: "String", note: "EDT MCRReqPlanIdContinuity." },
      { name: "Name", type: "String", note: "EDT Name." },
      { name: "PlanType", type: "Enum", note: "Enum ReqPlanType." },
      { name: "ReqPlanId", type: "String", note: "EDT ReqPlanId." },
      { name: "UseForecastDemand", type: "Enum", note: "EDT ReqUseForecastDemand; enum NoYes." },
      { name: "UseForecastSupply", type: "Enum", note: "EDT ReqUseForecastSupply; enum NoYes." },
    ],
  },
  ReqTransFirmLog: {
    name: "ReqTransFirmLog",
    description: "Master planning firming log entry recording the source reference, firmed document reference, item, quantity, date, and user.",
    module: "Master Planning",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/tables/supplychain/masterplanning/transaction/reqtransfirmlog",
    fields: [
      { name: "RecId", type: "Int64", note: "" },
      { name: "InventTransId", type: "String", note: "EDT InventTransId." },
      { name: "InventTransRefId", type: "String", note: "EDT InventTransRefId." },
      { name: "InventTransType", type: "Enum", note: "Enum InventTransType." },
      { name: "ItemId", type: "String", note: "EDT ItemId." },
      { name: "Qty", type: "Real", note: "EDT InventQty." },
      { name: "RefId", type: "String", note: "EDT InventTransRefId." },
      { name: "RefType", type: "Enum", note: "Enum ReqRefType." },
      { name: "ReqFirmDate", type: "Date", note: "EDT ReqFirmDate." },
      { name: "ReqFirmUserId", type: "String", note: "EDT ReqFirmUserId." },
      { name: "ReqPlanId", type: "String", note: "EDT ReqPlanId." },
    ],
  },
}

/** Every table the dataset knows about: stage-referenced tables plus full defs.
 *  A stage may reference a table that has no def (CustInterest, PaymTerm), so the
 *  union is the real population and every UI count must read this, never a subset.
 *  Frozen: sort() is applied once here so consumers cannot reorder shared state. */
export const allTableNames: readonly string[] = Object.freeze(
  Array.from(
    new Set([
      ...flows.flatMap((flow) => flow.stages.flatMap((stage) => stage.tables)),
      ...Object.keys(tableDefs),
    ])
  ).sort()
)
