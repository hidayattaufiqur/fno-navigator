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
  relations?: { from: string; to: string; note?: string; fields?: string[] }[]
  approvals?: string[]
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
          'Customer credit limit missing or zero — quote can be confirmed but SO may fail credit check',
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
            fields: ['PriceDiscAdmTrans.PriceDiscTableRecId → PriceDiscTable.RecId'],
            note: 'Active trade-agreement lines are stored in PriceDiscAdmTrans; the journal source is PriceDiscTable',
          },
        ],
        approvals: ['Quote approval workflow'],
      },
      {
        id: 'so',
        title: 'Confirm Sales Order',
        description: 'Convert quote (or create directly) into a confirmed sales order, setting delivery dates, dimensions, and inventory reservations.',
        roles: ['Sales', 'CSR'],
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
        tables: ['SalesTable', 'SalesLine', 'CustTable', 'InventDim', 'InventTable', 'AgreementHeader', 'AgreementLine', 'CustConfirmJour', 'CustConfirmTrans'],
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
            note: 'A sales order can be released against a sales agreement; SalesTable.MatchingAgreement FK references AgreementHeader.RecId (sales agreement classification) to inherit agreed pricing and quantity commitments',
          },
          {
            from: 'AgreementLine',
            to: 'AgreementHeader',
            fields: ['AgreementLine.Agreement → AgreementHeader.RecId'],
            note: 'Each AgreementLine specifies a quantity or value commitment for one item under the parent AgreementHeader',
          },
          {
            from: 'CustConfirmJour',
            to: 'SalesTable',
            fields: ['CustConfirmJour.SalesId = SalesTable.SalesId'],
            note: 'Posting a sales order confirmation creates a CustConfirmJour header with CustConfirmTrans lines',
          },
          {
            from: 'CustConfirmTrans',
            to: 'CustConfirmJour',
            fields: ['CustConfirmTrans.ConfirmId = CustConfirmJour.ConfirmId', 'CustConfirmTrans.SalesId = SalesTable.SalesId'],
            note: 'Line detail for a sales order confirmation; one row per confirmed order line',
          },
        ],
        approvals: ['Credit check or order approval workflow'],
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
        tables: ['WHSWorkTable', 'WHSWorkLine', 'WHSShipmentTable', 'WHSLoadTable', 'InventTrans', 'CustPackingSlipJour', 'CustPackingSlipTrans'],
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
            to: 'InventTrans',
            fields: ['Linked via ItemId + inventDimId + work context (no direct FK)'],
            note: 'Picking writes InventTrans records; StatusIssue goes Picked → Sold when the invoice is posted',
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
            note: 'Line detail for a delivery note; one row per shipped item line, links to InventTrans for inventory tracking',
          },
        ],
      },
      {
        id: 'invoice',
        title: 'Post Invoice',
        description: 'Generate and post a customer invoice, creating AR subledger (CustTrans) and general-ledger entries.',
        roles: ['AR'],
        menuPaths: ['Accounts receivable > Invoices > Open customer invoices'],
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
          'CustInvoiceTable (pending/unposted) vs CustInvoiceJour (posted) — two different tables, easy to confuse in extensions',
        ],
        prerequisites: ['Customer posting profiles', 'Sales tax codes and groups'],
        tables: ['CustInvoiceJour', 'CustInvoiceTrans', 'CustTrans', 'TaxTrans', 'LedgerTrans', 'TaxTable', 'TaxGroupHeading', 'TaxItemGroupHeading'],
        relations: [
          {
            from: 'CustInvoiceJour',
            to: 'SalesTable',
            fields: ['CustInvoiceJour.SalesId → SalesTable.SalesId'],
            note: 'Posted invoice header references the originating sales order',
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
            from: 'CustInvoiceJour',
            to: 'CustTrans',
            fields: ['CustTrans.Invoice = CustInvoiceJour.InvoiceId', 'CustTrans.AccountNum = CustInvoiceJour.OrderAccount'],
            note: 'Posting creates an open CustTrans debit record; it stays open until payment and settlement close it',
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
        ],
        prerequisites: ['Bank account (BankAccountTable)', 'Method of payment'],
        tables: ['CustTrans', 'CustSettlement', 'LedgerJournalTable', 'LedgerJournalTrans', 'BankAccountTable', 'BankAccountTrans', 'CashDisc'],
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
            from: 'CustSettlement',
            to: 'CustTrans',
            fields: ['CustSettlement.TransRecId → CustTrans.RecId (invoice transaction)', 'CustSettlement.OffsetRecid → CustTrans.RecId (payment transaction)'],
            note: 'CustSettlement is the linking record between the invoice CustTrans and payment CustTrans; settling closes both records',
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
    ],
    edges: [
      { from: 'quote', to: 'so' },
      { from: 'so', to: 'pickpack' },
      { from: 'pickpack', to: 'invoice' },
      { from: 'invoice', to: 'payment' },
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
        tables: ['PurchReqTable', 'PurchReqLine', 'VendTable', 'DimensionAttributeValueCombination'],
        approvals: ['Requisition approval workflow']
      },
      {
        id: 'po',
        title: 'Issue Purchase Order',
        description: 'Convert approved req or create PO direct.',
        roles: ['Buyer'],
        menuPaths: ['Procurement and sourcing > Purchase orders > All purchase orders'],
        docs: [
          {
            title: 'Purchase orders overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-order-overview'
          }
        ],
        pitfalls: ['Posting profile not set', 'Vendor delivery terms missing'],
        prerequisites: ['Vendor, terms, charges, taxes'],
        tables: ['PurchTable', 'PurchLine', 'VendTable', 'TaxGroupHeading', 'MarkupAutoTable', 'AgreementHeader', 'AgreementLine'],
        relations: [
          {
            from: 'PurchTable',
            to: 'VendTable',
            fields: ['PurchTable.OrderAccount = VendTable.AccountNum'],
            note: 'PO header references vendor',
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
        id: 'receipt',
        title: 'Product Receipt',
        description: 'Receive goods/services and update on-hand.',
        roles: ['Warehouse'],
        menuPaths: ['Accounts payable > Inquiries and reports > Purchase orders > Product receipt'],
        docs: [
          {
            title: 'Product receipts against purchase orders',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/procurement/product-receipt-against-purchase-orders'
          }
        ],
        pitfalls: ['Unit mismatch vs invoice', '3-way match tolerance exceeded'],
        prerequisites: ['Item model group', 'Unit conversions'],
        tables: ['PurchTable', 'PurchLine', 'VendPackingSlipJour', 'VendPackingSlipTrans', 'InventTrans']
      },
      {
        id: 'vendor-invoice',
        title: 'Vendor Invoice',
        description: 'Match invoice to receipt and post liabilities.',
        roles: ['AP'],
        menuPaths: ['Accounts payable > Invoices > Pending vendor invoices'],
        docs: [
          {
            title: 'Vendor invoices overview',
            url: 'https://learn.microsoft.com/dynamics365/finance/accounts-payable/vendor-invoices-overview'
          }
        ],
        pitfalls: ['Tax code mismatch', 'Posting profile missing', '3-way match failed'],
        prerequisites: ['Vendor posting profiles', 'Tax groups'],
        tables: ['VendInvoiceJour', 'VendInvoiceTrans', 'VendTrans', 'TaxTrans', 'LedgerTrans', 'VendInvoiceInfoTable', 'VendInvoiceInfoLine'],
        relations: [
          {
            from: 'VendInvoiceTrans',
            to: 'PurchLine',
            fields: ['VendInvoiceTrans.PurchID = PurchLine.PurchId', 'VendInvoiceTrans.LineNum = PurchLine.LineNumber'],
            note: 'Invoice lines match PO lines',
          },
          {
            from: 'VendInvoiceJour',
            to: 'PurchTable',
            fields: ['VendInvoiceJour.PurchId = PurchTable.PurchId'],
            note: 'Posted vendor invoice header references the purchase order it was posted from',
          },
          {
            from: 'VendInvoiceInfoTable',
            to: 'PurchTable',
            fields: ['VendInvoiceInfoTable.PurchId = PurchTable.PurchId', 'VendInvoiceInfoTable.OrderAccount = VendTable.AccountNum'],
            note: 'Pending vendor invoice header before posting; posting creates VendInvoiceJour',
          },
          {
            from: 'VendInvoiceInfoLine',
            to: 'VendInvoiceInfoTable',
            fields: ['VendInvoiceInfoLine.ParmId = VendInvoiceInfoTable.ParmId', 'VendInvoiceInfoLine.PurchLineRecId = PurchLine.RecId'],
            note: 'Pending vendor invoice line; FK to VendInvoiceInfoTable header via ParmId',
          },
        ],
        approvals: ['Invoice approval workflow']
      },
      {
        id: 'vendor-payment',
        title: 'Vendor Payment',
        description: 'Propose and settle vendor payments.',
        roles: ['AP'],
        menuPaths: ['Accounts payable > Payments > Payment journal'],
        docs: [
          {
            title: 'Vendor payment overview',
            url: 'https://learn.microsoft.com/dynamics365/finance/cash-bank-management/tasks/vendor-payment-overview'
          }
        ],
        pitfalls: ['Method of payment / bank not set', 'Settlement parameters wrong'],
        prerequisites: ['Bank account', 'Method of payment', 'Vendor terms'],
        tables: ['VendTrans', 'VendSettlement', 'LedgerJournalTable', 'LedgerJournalTrans', 'BankAccountTable']
      }
    ],
    edges: [
      { from: 'req', to: 'po' },
      { from: 'po', to: 'receipt' },
      { from: 'receipt', to: 'vendor-invoice' },
      { from: 'vendor-invoice', to: 'vendor-payment' }
    ]
  },
  {
    id: 'ptp',
    title: 'Plan to Produce',
    summary: 'Forecast, plan, execute production, and cost it.',
    module: 'Production',
    stages: [
      {
        id: 'forecast',
        title: 'Forecast / Master Plan',
        description: 'Create demand forecasts and run master planning.',
        roles: ['Planner'],
        menuPaths: ['Master planning > Forecast > Demand forecast'],
        docs: [
          {
            title: 'Demand forecasting setup',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/master-planning/demand-forecasting-setup'
          }
        ],
        pitfalls: ['Coverage groups missing', 'Forecast model not selected'],
        prerequisites: ['Coverage groups', 'Forecast model', 'Master plan'],
        tables: ['ReqTrans', 'ReqPlanSched', 'ReqPO', 'ReqPlanVersion', 'ForecastSales'],
        relations: [
          {
            from: 'ReqTrans',
            to: 'ReqPlanVersion',
            fields: ['ReqTrans.PlanVersion = ReqPlanVersion.RecId'],
            note: 'Planned transactions belong to a master plan version (planning run); forecast lines feed planned orders',
          },
          {
            from: 'ReqPO',
            to: 'PurchTable',
            fields: ['ReqPO.PurchId = PurchTable.PurchId'],
            note: 'Planned purchase orders firm into POs',
          },
        ],
      },
      {
        id: 'bom',
        title: 'BOM / Route',
        description: 'Model materials and operations.',
        roles: ['Production'],
        menuPaths: ['Product information management > Bills of materials and formulas > Bill of materials', 'Production control > Routes'],
        docs: [
          {
            title: 'Bills of materials and formulas',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/production-control/bill-of-material-bom'
          }
        ],
        pitfalls: ['Resource group capacity not set', 'BOM version not approved/activated'],
        prerequisites: ['Resources, resource groups, calendars', 'Cost groups'],
        tables: ['BOMTable', 'BOMVersion', 'RouteTable', 'RouteOpr', 'WrkCtrTable', 'ReqItemTable'],
        relations: [
          {
            from: 'BOMVersion',
            to: 'BOMTable',
            fields: ['BOMVersion.BOMId = BOMTable.BOMId'],
            note: 'Approved/activated BOM versions reference the BOM header; BOM holds the version lines',
          },
          {
            from: 'RouteOpr',
            to: 'RouteTable',
            fields: ['RouteOpr.RouteRelation = RouteTable.RouteId'],
            note: 'Operations tied to route header',
          },
        ],
      },
      {
        id: 'release',
        title: 'Release to Warehouse',
        description: 'Release planned/firmed orders to execution.',
        roles: ['Production', 'Warehouse'],
        menuPaths: ['Production control > Production orders > All production orders'],
        docs: [
          {
            title: 'Production process overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/production-control/production-process-overview'
          }
        ],
        pitfalls: ['Reservation hierarchies wrong', 'Route operation times missing'],
        prerequisites: ['Route/BOM approved', 'Warehouse parameters set'],
        tables: ['ProdTable', 'ProdBOM', 'ProdRoute', 'WHSWorkTable', 'WHSLoadTable', 'InventTrans'],
        relations: [
          {
            from: 'ProdBOM',
            to: 'BOM',
            fields: ['ProdBOM.BOMRefRecId = BOM.RecId', 'ProdBOM.ProdId = ProdTable.ProdId'],
            note: 'Production order BOM lines reference the BOM version used for the order',
          },
          {
            from: 'ProdRoute',
            to: 'RouteOpr',
            fields: ['ProdRoute.RouteOprRefRecId = RouteOpr.RecId', 'ProdRoute.ProdId = ProdTable.ProdId'],
            note: 'Route copied to production order; each production route line references the route operation it was copied from',
          },
        ],
      },
      {
        id: 'execute',
        title: 'Execute / Report as Finished',
        description: 'Start, register, RAF, and end production.',
        roles: ['Production'],
        menuPaths: ['Production control > Production orders > All production orders'],
        docs: [
          {
            title: 'Report production orders as finished',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/production-control/report-production-orders-as-finished'
          }
        ],
        pitfalls: ['Backflushing not set', 'License plate tracking mismatches'],
        prerequisites: ['Flushing principles', 'Operational resources and routes'],
        tables: ['ProdTable', 'ProdJournalTable', 'ProdJournalProd', 'ProdRouteJob', 'InventTrans'],
        relations: [
          {
            from: 'ProdJournalProd',
            to: 'ProdTable',
            fields: ['ProdJournalProd.ProdId = ProdTable.ProdId'],
            note: 'Production journals tied to order',
          },
          {
            from: 'ProdJournalProd',
            to: 'InventTransOrigin',
            fields: ['ProdJournalProd.InventTransId = InventTransOrigin.InventTransId'],
            note: 'RAF and consumption update inventory transactions via the inventory transaction origin',
          },
        ],
      },
      {
        id: 'cost',
        title: 'Cost and Close',
        description: 'End job, post cost, and reconcile variances.',
        roles: ['Controller'],
        menuPaths: ['Production control > Periodic > End production orders'],
        docs: [
          {
            title: 'Production order cost analysis',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/cost-management/production-order-cost-analysis'
          }
        ],
        pitfalls: ['Costing version not active', 'Inventory close blocked'],
        prerequisites: ['Costing version', 'Inventory close schedule'],
        tables: ['InventSettlement', 'InventTrans', 'ProdCalcTrans', 'LedgerTrans'],
        relations: [
          {
            from: 'ProdCalcTrans',
            to: 'ProdTable',
            note: 'Production costing by order',
            fields: ['ProdCalcTrans.ProdId = ProdTable.ProdId']
          },
          {
            from: 'InventSettlement',
            to: 'LedgerTrans',
            note: 'Inventory close settles to ledger',
            fields: ['InventSettlement.Voucher = LedgerTrans.Voucher', 'InventSettlement.TransRecId → InventTrans.RecId']
          }
        ]
      }
    ],
    edges: [
      { from: 'forecast', to: 'bom' },
      { from: 'bom', to: 'release' },
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
        menuPaths: ['Product information management > Released products'],
        docs: [
          {
            title: 'Product information overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/pim/product-information'
          }
        ],
        pitfalls: ['Dimension group wrong for scenario', 'Tracking not aligned with WMS'],
        prerequisites: ['Storage/tracking dimension groups', 'Item model group'],
        tables: ['InventTable', 'InventTableModule', 'InventModelGroup', 'InventDim', 'EcoResProduct', 'EcoResCategory', 'EcoResCategoryHierarchy', 'InventItemGroup'],
        relations: [
          {
            from: 'InventTable',
            to: 'EcoResProduct',
            fields: ['InventTable.Product → EcoResProduct.RecId'],
            note: 'Released product (per legal entity) links back to the shared global product definition',
          },
          {
            from: 'InventTableModule',
            to: 'InventTable',
            fields: ['InventTableModule.ItemId → InventTable.ItemId'],
            note: 'Up to three rows per item (ModuleType 1/2/3) carry module-specific unit, price, and discount',
          },
          {
            from: 'InventModelGroupItem',
            to: 'InventModelGroup',
            fields: ['InventModelGroupItem.ModelGroupId = InventModelGroup.ModelGroupId'],
            note: 'Item model group assigned per item (InventModelGroupItem); determines costing method (FIFO/StdCost/etc.) and physical/financial posting policy',
          },
          {
            from: 'EcoResCategory',
            to: 'EcoResCategoryHierarchy',
            fields: ['EcoResCategory.CategoryHierarchy = EcoResCategoryHierarchy.RecId'],
            note: 'Product category node in a hierarchy; products assigned via EcoResProductCategory',
          },
          {
            from: 'InventItemGroupItem',
            to: 'InventItemGroup',
            fields: ['InventItemGroupItem.ItemGroupId = InventItemGroup.ItemGroupId'],
            note: 'Item group assigned per item (InventItemGroupItem); drives inventory posting profile and tax item groups',
          },
        ],
      },
      {
        id: 'onhand',
        title: 'On-hand and Reservations',
        description: 'Monitor availability and reservations.',
        roles: ['Warehouse', 'Sales', 'Planner'],
        menuPaths: ['Inventory management > Inquiries and reports > On-hand inventory'],
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
            note: 'On-hand summary per dimension',
            fields: ['InventSum.InventDimId = InventDim.InventDimId']
          },
          {
            from: 'WHSInventReserve',
            to: 'InventDim',
            note: 'Warehouse reservation per LP/location',
            fields: ['WHSInventReserve.InventDimId = InventDim.InventDimId']
          }
        ]
      },
      {
        id: 'movement',
        title: 'Transfer / Movement',
        description: 'Transfers across sites/warehouses/locations.',
        roles: ['Warehouse'],
        menuPaths: ['Inventory management > Periodic > Transfer orders'],
        docs: [
          {
            title: 'Transfer orders',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/warehousing/create-transfer-order-from-warehouse-app'
          }
        ],
        pitfalls: ['In-transit warehouse missing', 'Dimensions not aligned on transfer'],
        prerequisites: ['Transfer orders setup', 'In-transit settings'],
        tables: ['InventTransferTable', 'InventTransferLine', 'InventTrans', 'WHSWorkTable', 'WHSLoadTable'],
        relations: [
          {
            from: 'InventTransferLine',
            to: 'InventTrans',
            note: 'Transfer issue/receipt creates inventory transactions',
            fields: ['InventTrans.InventTransId from transfer posting', 'InventTrans.ReferenceId = InventTransferLine.TransferId']
          },
          {
            from: 'InventTransferLine',
            to: 'WHSWorkTable',
            note: 'If WMS, transfer lines generate work',
            fields: ['WHSWorkTable.LoadId / WorkId linked via transfer wave']
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
            note: 'Cycle count plans generate count work; counted quantities are posted via counting journals (InventJournalTable/InventJournalTrans)',
          },
          {
            from: 'InventJournalTrans',
            to: 'InventTransOrigin',
            fields: ['InventJournalTrans.InventTransId = InventTransOrigin.InventTransId'],
            note: 'Posting creates inventory transactions via the inventory transaction origin',
          },
        ],
      },
      {
        id: 'close',
        title: 'Inventory Close',
        description: 'Close period and settle receipts/issues.',
        roles: ['Controller'],
        menuPaths: ['Inventory management > Periodic tasks > Close and adjust'],
        docs: [
          {
            title: 'Inventory close',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-close'
          }
        ],
        pitfalls: ['Open production or transfers blocking', 'High variance from costing version'],
        prerequisites: ['Costing version final', 'All POs/SOs posted'],
        tables: ['InventSettlement', 'InventTrans', 'InventCostList', 'LedgerTrans'],
        relations: [
          {
            from: 'InventSettlement',
            to: 'InventTrans',
            note: 'Close settles receipts/issues',
            fields: ['InventSettlement.TransRecId = InventTrans.RecId']
          },
          {
            from: 'InventSettlement',
            to: 'LedgerTrans',
            note: 'Adjustments post to ledger',
            fields: ['InventSettlement.Voucher = LedgerTrans.Voucher']
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
        description: 'Scope, pricing, and quote approvals.',
        roles: ['Project', 'Sales'],
        menuPaths: ['Project management and accounting > Quotes'],
        docs: [
          {
            title: 'Project quotations',
            url: 'https://learn.microsoft.com/en-us/dynamics365/finance/project-management/project-quotations'
          }
        ],
        pitfalls: ['Funding source not set', 'Category setup incomplete'],
        prerequisites: ['Project groups', 'Categories', 'Funding sources'],
        tables: ['ProjTable', 'ProjQuotationTable', 'ProjGroup', 'ProjFundingSource'],
        approvals: ['Quote approval workflow']
      },
      {
        id: 'proj-contract',
        title: 'Project Contract & WBS',
        description: 'Contracts, subprojects, WBS planning.',
        roles: ['Project'],
        menuPaths: ['Project management and accounting > Projects'],
        docs: [
          {
            title: 'Project contracts',
            url: 'https://learn.microsoft.com/en-us/dynamics365/finance/project-management/project-contracts'
          }
        ],
        pitfalls: ['WBS not published', 'Funding rules incomplete'],
        prerequisites: ['Project contract', 'Funding rules', 'WBS'],
        tables: ['ProjTable', 'ProjInvoiceTable', 'ProjFundingSource', 'ProjWBSActivity', 'ProjWBSLineProperty'],
        relations: [
          {
            from: 'ProjWBSActivity',
            to: 'ProjTable',
            fields: ['ProjWBSActivity.ProjId = ProjTable.ProjId'],
            note: 'WBS activities belong to project',
          },
          {
            from: 'ProjFundingSource',
            to: 'ProjInvoiceTable',
            fields: ['ProjFundingSource.ContractId = ProjInvoiceTable.ProjInvoiceProjId'],
            note: 'Funding rules are linked to the project billing contract (ProjInvoiceTable)',
          },
        ],
      },
      {
        id: 'proj-exec',
        title: 'Execute & Track',
        description: 'Timesheets, expenses, item consumption.',
        roles: ['Project'],
        menuPaths: ['Project management and accounting > Timesheets'],
        docs: [
          {
            title: 'Project transactions overview',
            url: 'https://learn.microsoft.com/dynamics365/project-operations/prod-pma/overview-project-management-accounting'
          }
        ],
        pitfalls: ['Category validation failing', 'Resource not assigned'],
        prerequisites: ['Categories allowed on project', 'Worker setup'],
        tables: ['ProjEmplTrans', 'ProjItemTrans', 'ProjCostTrans', 'HcmWorker', 'ProjCategory'],
        relations: [
          {
            from: 'ProjEmplTrans',
            to: 'HcmWorker',
            note: 'Timesheets reference workers',
            fields: ['ProjEmplTrans.Worker = HcmWorker.RecId']
          },
          {
            from: 'ProjEmplTrans',
            to: 'ProjTable',
            note: 'Transactions posted to project',
            fields: ['ProjEmplTrans.ProjId = ProjTable.ProjId']
          }
        ]
      },
      {
        id: 'proj-invoice',
        title: 'Invoice (On-account/Progress)',
        description: 'Create invoice proposals and post revenue.',
        roles: ['Project', 'AR'],
        menuPaths: ['Project management and accounting > Periodic > Invoice proposals'],
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
            note: 'Posted project invoice header references the project billing contract',
          },
        ],
        approvals: ['Invoice approval workflow (optional)']
      },
      {
        id: 'proj-revrec',
        title: 'Revenue Recognition',
        description: 'Recognize and post revenue/deferrals.',
        roles: ['Controller'],
        menuPaths: ['Project management and accounting > Periodic > Revenue recognition'],
        docs: [
          {
            title: 'Recognize project revenue',
            url: 'https://learn.microsoft.com/en-us/dynamics365/guidance/business-processes/project-to-profit-recognize-project-revenue'
          }
        ],
        pitfalls: ['Schedule not set', 'Allocation method wrong'],
        prerequisites: ['Revenue recognition schedule', 'Project group rules'],
        tables: ['ProjRevenueTrans', 'ProjCostTrans', 'LedgerTrans', 'ProjTable'],
        relations: [
          {
            from: 'ProjRevenueTrans',
            to: 'ProjTable',
            note: 'Revenue posted per project',
            fields: ['ProjRevenueTrans.ProjId = ProjTable.ProjId']
          },
          {
            from: 'ProjRevenueTrans',
            to: 'LedgerTrans',
            note: 'Recognition posts to ledger',
            fields: ['ProjRevenueTrans.Voucher = LedgerTrans.Voucher']
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
    summary: 'Journal, allocate, consolidate, and close periods.',
    module: 'Finance',
    stages: [
      {
        id: 'gl-setup',
        title: 'GL & Calendar Setup',
        description: 'Ledger, currency, periods, and dimensions.',
        roles: ['Controller'],
        menuPaths: ['General ledger > Setup > Ledger'],
        docs: [
          {
            title: 'Plan your chart of accounts',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/plan-chart-of-accounts'
          }
        ],
        pitfalls: ['Ledger calendar closed', 'Posting layers misused'],
        prerequisites: ['Ledger, calendars, currencies', 'Dimensions'],
        tables: ['Ledger', 'FiscalCalendar', 'Currency', 'DimensionHierarchy', 'DimensionAttributeValueCombination', 'CompanyInfo', 'OMOperatingUnit'],
        relations: [
          {
            from: 'MainAccount',
            to: 'LedgerChartOfAccounts',
            fields: ['MainAccount.LedgerChartOfAccounts → LedgerChartOfAccounts.RecId'],
            note: 'Each main account belongs to exactly one chart of accounts',
          },
          {
            from: 'Ledger',
            to: 'LedgerChartOfAccounts',
            fields: ['Ledger.ChartOfAccounts → LedgerChartOfAccounts.RecId'],
            note: 'A legal entity ledger is assigned to one chart of accounts; chart can be shared across entities',
          },
          {
            from: 'FiscalCalendarPeriod',
            to: 'FiscalCalendar',
            fields: ['FiscalCalendarPeriod.FiscalCalendar → FiscalCalendar.RecId'],
            note: 'Each accounting period belongs to a fiscal calendar',
          },
          {
            from: 'Ledger',
            to: 'FiscalCalendar',
            fields: ['Ledger.FiscalCalendar → FiscalCalendar.RecId'],
            note: 'Legal entity ledger references its fiscal calendar, governing which periods are available for posting',
          },
          {
            from: 'Ledger',
            to: 'CompanyInfo',
            fields: ['Ledger.PrimaryForLegalEntity = CompanyInfo.RecId'],
            note: 'Legal entity configuration record - each legal entity ledger record binds to its CompanyInfo record',
          },
          {
            from: 'DimensionAttributeValue',
            to: 'OMOperatingUnit',
            fields: ['DimensionAttributeValue.EntityInstance = OMOperatingUnit.RecId'],
            note: 'Generic operating unit table - used as financial dimension values for BusinessUnit, Department, CostCenter, and similar org unit types (polymorphic relation)',
          },
        ],
      },
      {
        id: 'journals',
        title: 'Journals & Allocations',
        description: 'Daily journals and allocation rules.',
        roles: ['Controller'],
        menuPaths: ['General ledger > Journal entries > General journal'],
        docs: [
          {
            title: 'Ledger and subledger accounting overview',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/ledger-subledger'
          }
        ],
        pitfalls: ['Approval workflow missing', 'Posting profile errors'],
        prerequisites: ['Journal names', 'Approval workflow (optional)'],
        tables: ['LedgerJournalTable', 'LedgerJournalTrans', 'LedgerAllocationRule', 'LedgerTrans', 'GeneralJournalEntry', 'GeneralJournalAccountEntry'],
        relations: [
          { from: 'LedgerJournalTrans', to: 'LedgerJournalTable', note: 'Lines tied to journal header', fields: ['LedgerJournalTrans.JournalNum → LedgerJournalTable.JournalNum'] },
          {
            from: 'LedgerJournalTrans',
            to: 'LedgerTrans',
            note: 'Posting creates ledger entries',
            fields: ['LedgerJournalTrans.Voucher = LedgerTrans.Voucher', 'LedgerJournalTrans.Account = LedgerTrans.AccountNum']
          },
          {
            from: 'GeneralJournalAccountEntry',
            to: 'GeneralJournalEntry',
            fields: ['GeneralJournalAccountEntry.GeneralJournalEntry = GeneralJournalEntry.RecId'],
            note: 'Each posted GL voucher creates one GeneralJournalEntry header; GeneralJournalAccountEntry holds the debit/credit lines',
          },
          {
            from: 'GeneralJournalAccountEntry',
            to: 'DimensionAttributeValueCombination',
            fields: ['GeneralJournalAccountEntry.LedgerDimension = DimensionAttributeValueCombination.RecId'],
            note: 'Individual debit/credit line on a posted GL voucher; FK to GeneralJournalEntry header and to DimensionAttributeValueCombination for the ledger account',
          },
        ],
        approvals: ['Journal approval workflow']
      },
      {
        id: 'consol',
        title: 'Consolidation & Elimination',
        description: 'Combine entities and eliminate intercompany.',
        roles: ['Controller'],
        menuPaths: ['General ledger > Consolidations'],
        docs: [
          {
            title: 'Prepare a legal entity for the consolidation process',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/prepare-company-for-consolidation'
          }
        ],
        pitfalls: ['Currency translation setup wrong', 'Main account mapping missing'],
        prerequisites: ['Consolidation group', 'Exchange rates', 'Account mappings'],
        tables: ['LedgerConsolidateTemplate', 'LedgerConsolidateHist', 'MainAccount', 'ExchangeRate'],
        relations: [
          {
            from: 'LedgerConsolidateHist',
            to: 'LedgerConsolidateTemplate',
            fields: ['LedgerConsolidateHist.ConsolidateTemplate = LedgerConsolidateTemplate.RecId'],
            note: 'Each consolidation run (history record) follows a consolidation template defining source legal entities, account mappings, and currency translation',
          },
        ],
      },
      {
        id: 'close',
        title: 'Period Close & Reporting',
        description: 'Close subledgers, run close checklist, report.',
        roles: ['Controller'],
        menuPaths: ['General ledger > Period close'],
        docs: [
          {
            title: 'Year-end close',
            url: 'https://learn.microsoft.com/dynamics365/finance/general-ledger/year-end-close'
          }
        ],
        pitfalls: ['Subledger not closed', 'Financial reporter trees incomplete'],
        prerequisites: ['Close checklist', 'Financial reporter trees'],
        tables: ['LedgerPeriodClose', 'LedgerTrans', 'FinancialReportingTree', 'SubledgerVoucherGeneralJournalEntry'],
        relations: [
          {
            from: 'LedgerPeriodClose',
            to: 'LedgerTrans',
            fields: ['Period/ledger linkage via LedgerPeriodClose.Ledger = LedgerTrans.Ledger'],
            note: 'Close tasks depend on ledger postings completion',
          },
          {
            from: 'SubledgerVoucherGeneralJournalEntry',
            to: 'GeneralJournalEntry',
            fields: ['SubledgerVoucherGeneralJournalEntry.GeneralJournalEntry = GeneralJournalEntry.RecId'],
            note: 'Subledger vouchers link to their posted GL journal entry',
          },
        ],
      }
    ],
    edges: [
      { from: 'gl-setup', to: 'journals' },
      { from: 'journals', to: 'consol' },
      { from: 'consol', to: 'close' }
    ]
  },
  {
    id: 'hr',
    title: 'Hire to Retire',
    summary: 'Onboard workers, manage compensation, and exit.',
    module: 'HR',
    stages: [
      {
        id: 'positions',
        title: 'Positions & Workers',
        description: 'Create positions, assign workers, and employment.',
        roles: ['HR'],
        menuPaths: ['Human resources > Workers'],
        docs: [
          {
            title: 'Positions — Dynamics 365 Human Resources',
            url: 'https://learn.microsoft.com/dynamics365/human-resources/hr-personnel-positions'
          }
        ],
        pitfalls: ['Position hierarchies broken', 'Personnel actions not enabled'],
        prerequisites: ['Departments, jobs, positions'],
        tables: ['HcmWorker', 'HcmPosition', 'HcmEmployment', 'DirPerson', 'HcmPositionHierarchy'],
        relations: [
          {
            from: 'HcmEmployment',
            to: 'HcmWorker',
            note: 'Employment records per worker',
            fields: ['HcmEmployment.Worker = HcmWorker.RecId']
          },
          {
            from: 'HcmPositionHierarchy',
            to: 'HcmPosition',
            note: 'Positions tied into hierarchy',
            fields: ['HcmPositionHierarchy.PositionId = HcmPosition.RecId']
          }
        ]
      },
      {
        id: 'onboard',
        title: 'Onboard',
        description: 'Tasks, documents, and access.',
        roles: ['HR', 'IT'],
        menuPaths: ['Human resources > Workers > Onboarding'],
        docs: [
          {
            title: 'Task management (onboarding, offboarding, transitions)',
            url: 'https://learn.microsoft.com/dynamics365/human-resources/hr-task-mgmt'
          }
        ],
        pitfalls: ['Missing delegation', 'Security roles not assigned'],
        prerequisites: ['Checklists', 'Security roles'],
        tables: ['HcmOnboardingTask', 'HcmChecklist', 'SecurityUserRole', 'HcmWorker'],
        relations: [
          {
            from: 'HcmChecklist',
            to: 'HcmWorker',
            note: 'Assigned onboarding tasks to worker',
            fields: ['HcmChecklist.Worker = HcmWorker.RecId']
          },
          {
            from: 'SecurityUserRole',
            to: 'HcmWorker',
            note: 'Roles assigned to worker\'s user',
            fields: ['SecurityUserRole.UserId linked to worker user']
          }
        ]
      },
      {
        id: 'comp',
        title: 'Compensation & Benefits',
        description: 'Plans, eligibility, enrollment.',
        roles: ['HR'],
        menuPaths: ['Human resources > Compensation management'],
        docs: [
          {
            title: 'Compensation plans overview',
            url: 'https://learn.microsoft.com/dynamics365/human-resources/hr-compensation-overview'
          }
        ],
        pitfalls: ['Eligibility rules wrong', 'Plan periods not active'],
        prerequisites: ['Comp plans', 'Benefit plans', 'Eligibility rules'],
        tables: ['HcmCompPlan', 'HcmCompFixedPlan', 'HcmBenefitPlan', 'HcmEligibilityRule', 'HcmWorker'],
        relations: [
          {
            from: 'HcmCompFixedPlan',
            to: 'HcmWorker',
            note: 'Worker enrolled in comp plan',
            fields: ['HcmCompFixedPlan.Worker = HcmWorker.RecId']
          },
          {
            from: 'HcmBenefitPlan',
            to: 'HcmEligibilityRule',
            note: 'Eligibility rules applied to benefit plan',
            fields: ['Eligibility rules per benefit plan config']
          }
        ]
      },
      {
        id: 'absence',
        title: 'Leave / Absence',
        description: 'Accruals, requests, approvals.',
        roles: ['HR'],
        menuPaths: ['Human resources > Leave and absence'],
        docs: [
          {
            title: 'Configure leave and absence types',
            url: 'https://learn.microsoft.com/dynamics365/human-resources/hr-leave-and-absence-types'
          }
        ],
        pitfalls: ['Accrual schedule not run', 'Approval workflow missing'],
        prerequisites: ['Leave types', 'Accrual schedules'],
        tables: ['HcmLeaveType', 'HcmLeaveBank', 'HcmLeaveRequest', 'HcmLeaveAccrualSchedule'],
        relations: [
          {
            from: 'HcmLeaveRequest',
            to: 'HcmLeaveBank',
            note: 'Requests consume leave balances',
            fields: ['HcmLeaveRequest.BankId = HcmLeaveBank.BankId']
          },
          {
            from: 'HcmLeaveAccrualSchedule',
            to: 'HcmLeaveBank',
            note: 'Accruals feed balance',
            fields: ['HcmLeaveAccrualSchedule.BankId = HcmLeaveBank.BankId']
          }
        ],
        approvals: ['Leave approval workflow']
      },
      {
        id: 'offboard',
        title: 'Offboard',
        description: 'Terminate, final pay, and revoke access.',
        roles: ['HR', 'IT'],
        menuPaths: ['Human resources > Workers > Terminate'],
        docs: [
          {
            title: 'Overview of the Terminate workers business process',
            url: 'https://learn.microsoft.com/dynamics365/guidance/business-processes/hire-to-retire-onboard-terminate-employment'
          }
        ],
        pitfalls: ['Benefits not ended', 'Security not revoked'],
        prerequisites: ['Offboarding checklist', 'Final pay rules'],
        tables: ['HcmEmployment', 'HcmSeparation', 'HcmChecklist', 'SecurityUserRole'],
        relations: [
          {
            from: 'HcmSeparation',
            to: 'HcmEmployment',
            note: 'Termination closes employment',
            fields: ['HcmSeparation.Employment = HcmEmployment.RecId']
          },
          {
            from: 'SecurityUserRole',
            to: 'HcmWorker',
            note: 'Roles removed at termination',
            fields: ['SecurityUserRole.UserId linked to worker user']
          }
        ]
      }
    ],
    edges: [
      { from: 'positions', to: 'onboard' },
      { from: 'onboard', to: 'comp' },
      { from: 'comp', to: 'absence' },
      { from: 'absence', to: 'offboard' }
    ]
  },
  {
    id: 'service',
    title: 'Service Lifecycle',
    summary: 'Service agreements, orders, dispatch, and billing.',
    module: 'Service',
    stages: [
      {
        id: 'agreement',
        title: 'Service Agreement',
        description: 'Define coverage, SLA, and billing rules.',
        roles: ['Service'],
        menuPaths: ['Service management > Service agreements'],
        docs: [
          {
            title: 'Develop and establish service agreements overview',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/service-management/service-agreements'
          }
        ],
        pitfalls: ['Coverage group not set', 'Subscription timing wrong'],
        prerequisites: ['Service agreements', 'Billing rules'],
        tables: ['SMASubscriptionTable', 'SMAAgreementTable', 'SMAAgreementLine', 'CustTable'],
        relations: [
          {
            from: 'SMAAgreementLine',
            to: 'SMAAgreementTable',
            fields: ['SMAAgreementLine.AgreementId → SMAAgreementTable.AgreementId'],
            note: 'Lines belong to their agreement header',
          },
        ],
        approvals: ['Agreement approval (optional)']
      },
      {
        id: 'service-order',
        title: 'Service Orders',
        description: 'Create orders, assign items/hours, schedule.',
        roles: ['Service'],
        menuPaths: ['Service management > Service orders'],
        docs: [
          {
            title: 'Service orders',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/service-management/service-orders'
          }
        ],
        pitfalls: ['Service item not linked', 'Contract lines missing'],
        prerequisites: ['Service items', 'Technician resources'],
        tables: ['SMAServiceOrderTable', 'SMAServiceOrderLine', 'SMAServiceObjectTable', 'SMAAgreementLine'],
        relations: [
          {
            from: 'SMAServiceOrderLine',
            to: 'SMAAgreementLine',
            fields: ['SMAServiceOrderLine.AgreementId = SMAAgreementLine.AgreementId', 'SMAServiceOrderLine.AgreementLineNum = SMAAgreementLine.AgreementLineNum'],
            note: 'Lines consume agreement coverage',
          },
          {
            from: 'SMAServiceOrderLine',
            to: 'SMAServiceObjectTable',
            fields: ['SMAServiceOrderLine.ServiceObjectId = SMAServiceObjectTable.ServiceObjectId'],
            note: 'Lines reference service objects/assets',
          },
        ],
      },
      {
        id: 'dispatch',
        title: 'Dispatch',
        description: 'Schedule technicians and manage visits.',
        roles: ['Service'],
        menuPaths: ['Service management > Periodic tasks > Dispatch board'],
        docs: [
          {
            title: 'Dispatch board',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/service-management/dispatch-board'
          }
        ],
        pitfalls: ['Calendar not set', 'Travel time not considered'],
        prerequisites: ['Resource calendars', 'Skills/skills mapping'],
        tables: ['SMAServiceOrderTable', 'SMADispatchTeamTable', 'WrkCtrTable', 'ResResourceIdentifier'],
        relations: [
          {
            from: 'SMADispatchWorkerSetup',
            to: 'SMADispatchTeamTable',
            fields: ['SMADispatchWorkerSetup.DispatchTeamId = SMADispatchTeamTable.DispatchTeamId'],
            note: 'Dispatch teams group technicians; workers are assigned to dispatch teams via SMADispatchWorkerSetup',
          },
        ],
      },
      {
        id: 'service-bill',
        title: 'Bill Service',
        description: 'Invoice time/materials and subscriptions.',
        roles: ['Service', 'AR'],
        menuPaths: ['Service management > Service orders > Service invoices'],
        docs: [
          {
            title: 'Service subscriptions',
            url: 'https://learn.microsoft.com/dynamics365/supply-chain/service-management/service-subscriptions'
          }
        ],
        pitfalls: ['Posting profiles missing', 'Subscription period misaligned'],
        prerequisites: ['Posting profiles', 'Subscription setup'],
        tables: ['SMAServiceOrderTable', 'SMAServiceOrderLine', 'CustInvoiceTrans', 'SMASubscriptionTable'],
        relations: [

        ],
        approvals: ['Invoice approval workflow (optional)']
      }
    ],
    edges: [
      { from: 'agreement', to: 'service-order' },
      { from: 'service-order', to: 'dispatch' },
      { from: 'dispatch', to: 'service-bill' }
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
      { name: "PurchStatus", type: "Int32", note: "Enum: None=0, OpenOrder=1, Received=2, Invoiced=3, Cancelled=4" },
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
      { name: "LineNumber", type: "Decimal", note: "Line number within the purchase order." },
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
      { name: "PurchID", type: "String", fkTarget: "PurchLine.PurchId", note: "Purchase order number the invoice line originates from (capital ID in AOT)." },
      { name: "LineNum", type: "Decimal", fkTarget: "PurchLine.LineNumber", note: "PO line number; combined with PurchId links back to PurchLine" },
      { name: "ItemId", type: "String", fkTarget: "InventTable.ItemId", note: "Product invoiced on this line" },
      { name: "Qty", type: "Decimal", note: "Invoiced quantity" },
      { name: "LineAmountMST", type: "Decimal", note: "Net line amount in accounting currency" },
      { name: "TaxGroup", type: "String", fkTarget: "TaxGroupHeading.TaxGroup", note: "Sales-tax group applied on this invoice line" },
    ],
  },

  VendTrans: {
    name: "VendTrans",
    description: "Vendor accounts-payable subledger transaction. Every posted AP event (invoice, payment, credit note, adjustment) creates a record here; the open balance is the sum of unsettled records.",
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

  LedgerTrans: {
    name: "LedgerTrans",
    description: "General ledger posted transaction. NOTE: In D365FO (AX 2012+) the legacy LedgerTrans table was replaced by GeneralJournalEntry (header) + GeneralJournalAccountEntry (lines). This entry describes GeneralJournalEntry — the posted GL transaction header containing the voucher, accounting date, posting layer, and link to subledger source documents.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/finance/ledger/transactionheader/generaljournalentry",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "JournalNumber", type: "String", note: "Subledger journal number (internal posting reference)" },
      { name: "AccountingDate", type: "Date", note: "Date on which the entry is recognised in the GL" },
      { name: "Voucher", type: "String", note: "Voucher number; connects to VendTrans.Voucher, CustTrans.Voucher, etc." },
      { name: "PostingLayer", type: "Int32", note: "Enum: Current=0, Operations=1, Tax=2; separates reporting layers" },
      { name: "IsSystemGenerated", type: "Int32", note: "1 if auto-generated by subledger posting engine; 0 if entered manually" },
      { name: "SystemGeneratedEntryType", type: "Int32", note: "Indicates the subledger module that originated this entry (AP, AR, Inventory, etc.)" },
      { name: "TransactionLog_RecId", type: "Int64", fkTarget: "TransactionLog.RecId", note: "FK to the immutable transaction log for audit trail" },
    ],
  },

  GeneralJournalEntry: {
    name: "GeneralJournalEntry",
    description: "Posted GL voucher header table. Every financial posting (AP invoice, AR payment, journal entry, etc.) creates exactly one row here, replacing the legacy LedgerTrans table from AX 2009.",
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

  LedgerPeriodClose: {
    name: "LedgerPeriodClose",
    description: "Period/year-end closing task record. Part of the Financial period close workspace. Tracks each closing task's template, associated fiscal period, assigned company, status, due date, and completion across the closing schedule.",
    module: "General Ledger",
    docsUrl: "https://learn.microsoft.com/dynamics365/finance/general-ledger/financial-period-close-workspace",
    fields: [
      { name: "RecId", type: "int64", note: "Primary key (surrogate)" },
      { name: "TaskName", type: "string", note: "Name of the closing task (e.g., 'Post accruals', 'Run currency revaluation')" },
      { name: "CloseGroup", type: "string (FK → LedgerFiscalCloseGroup)", note: "Closing schedule / group the task belongs to" },
      { name: "FiscalCalendarPeriod", type: "int64 (FK → FiscalCalendarPeriod.RecId)", note: "The fiscal period this closing task is scoped to" },
      { name: "DueDate", type: "date", note: "Calculated task due date based on template relative days and period end date" },
      { name: "Status", type: "int32 (enum)", note: "Task status: 0=Open, 1=Completed, 2=Blocked (dependency not met)" },
      { name: "DataAreaId", type: "string", note: "Legal entity the task applies to" },
    ],
  },

  FinancialReportingTree: {
    name: "FinancialReportingTree",
    description: "Reporting tree definition used in Financial reporting. Defines the hierarchy of reporting units (nodes) that map to legal entities, departments, or cost centres.",
    module: "General Ledger / Financial Reporting",
    docsUrl: "https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/analytics/financial-reporting-tree-definitions",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "TreeName", type: "String", note: "Natural key — name of the reporting tree definition" },
      { name: "Description", type: "String", note: "Human-readable description of the reporting tree" },
      { name: "CurrentVersion", type: "Int32", note: "Active version number of the tree definition" },
      { name: "IsActive", type: "Enum", note: "Whether this tree is active for report generation" },
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
    description: "Inventory cost settlement record created by the inventory close process. Each row links a financially posted receipt transaction (TransRecId) to a financially posted issue transaction (SettleRecId), recording the quantity settled and the cost adjustment amount. Cancelled settlements reference the original via the Cancelled FK.",
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
  HcmPosition: {
    name: "HcmPosition",
    description: "Individual position instance within an organization — a specific funded slot tied to a Job. Defines the role, department assignment, reporting structure, activation/retirement dates, and compensation region. A position can have at most one active worker assignment at any time.",
    module: "Human Resources",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/entities/humanresources/hrm/hcmpositionv2entity",
    fields: [
      { name: "PositionId", type: "String(20)", note: "Natural key, user-defined position ID (e.g. '000220')" },
      { name: "JobId", type: "String(20)", note: "FK → HcmJob; the job definition this position is an instance of" },
      { name: "PositionTypeId", type: "String(20)", note: "FK → HcmPositionType (Full-time, Part-time, etc.); nullable" },
      { name: "TitleId", type: "String(10)", note: "FK → HcmTitle; position title shown on worker record; nullable" },
      { name: "Activation", type: "UtcDateTime", note: "Date the position becomes active in the system" },
      { name: "Retirement", type: "UtcDateTime", note: "Date the position is retired / deactivated; nullable" },
      { name: "DepartmentNumber", type: "String(10)", note: "FK → OMOperatingUnit (Department); nullable" },
      { name: "CompensationRegionId", type: "String(10)", note: "FK → HcmCompensationRegion; drives comp grid selection; nullable" },
    ],
  },

  HcmPositionHierarchy: {
    name: "HcmPositionHierarchy",
    description: "Defines parent-child reporting relationships between positions for a given hierarchy type (Line, Matrix, Project, etc.). Supports multiple concurrent hierarchies. Date-effective via ValidFrom/ValidTo.",
    module: "Human Resources",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/entities/humanresources/hrm/hcmpositionhierarchyentity",
    fields: [
      { name: "PositionId", type: "String(20)", note: "FK → HcmPosition; the child (reporting) position" },
      { name: "ParentPositionId", type: "String(20)", note: "FK → HcmPosition; the parent ('reports to') position" },
      { name: "PositionHierarchyType", type: "String(20)", note: "FK → HcmPositionHierarchyType; identifies the hierarchy (e.g. 'Line')" },
      { name: "HierarchyType", type: "String(20)", note: "Denormalized hierarchy type name" },
      { name: "ValidFrom", type: "UtcDateTime", note: "Effective start date of this reporting relationship" },
      { name: "ValidTo", type: "UtcDateTime", note: "Effective end date; nullable for open-ended relationships" },
    ],
  },

  HcmWorker: {
    name: "HcmWorker",
    description: "Shared worker record for both employees (WorkerType=Employee) and contractors (WorkerType=Contractor). Identified by PersonnelNumber. Links to DirPerson for all personal/contact data stored in the Global Address Book.",
    module: "Human Resources",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/entities/humanresources/hrm/hcmworkerentity",
    fields: [
      { name: "PersonnelNumber", type: "String(20)", note: "Natural key for the worker across the system" },
      { name: "WorkerType", type: "Enum", note: "Employee or Contractor" },
      { name: "Person", type: "Int64", note: "FK → DirPerson.RecId; links to the GAB party record for personal data" },
      { name: "AllowRehire", type: "Enum", note: "Yes / No / Under conditions; set on separation" },
      { name: "ObjectId", type: "String(36)", note: "GUID-style unique identifier used in API / Dataverse integration" },
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
    description: "Employment period for a worker in a specific legal entity. Tracks start and end dates, employment type, work calendar, and regulatory establishment. An open EmploymentEndDate means currently employed. Multiple records can exist per worker across different companies.",
    module: "Human Resources",
    docsUrl: "https://learn.microsoft.com/common-data-model/schema/core/operationscommon/entities/humanresources/hrm/hcmemploymententity",
    fields: [
      { name: "Worker", type: "Int64", note: "FK → HcmWorker.RecId; the employed worker" },
      { name: "PersonnelNumber", type: "String(20)", note: "Denormalized natural key of the worker" },
      { name: "LegalEntityId", type: "String(4)", note: "FK → CompanyInfo; the employing legal entity / company" },
      { name: "EmploymentStartDate", type: "UtcDateTime", note: "Official start date of employment" },
      { name: "EmploymentEndDate", type: "UtcDateTime", note: "End date; NULL or open = currently employed" },
      { name: "WorkerType", type: "Enum", note: "Employee or Contractor for this employment period" },
      { name: "CalendarId", type: "String(10)", note: "FK → WorkCalendar; work schedule calendar; nullable" },
    ],
  },

  HcmOnboardingTask: {
    name: "HcmOnboardingTask",
    description: "Individual task record within an onboarding, offboarding, or transition checklist. Can be assigned to a specific worker, position, group of positions, the new hire's manager, or the affected employee. Due date is calculated as an offset (days) from the hire/termination/transition date.",
    module: "Human Resources – Task Management",
    docsUrl: "https://learn.microsoft.com/dynamics365/human-resources/hr-task-mgmt",
    fields: [
      { name: "TaskId", type: "String(36)", note: "PK; GUID-style unique task identifier" },
      { name: "Name", type: "String(100)", note: "Display name of the task" },
      { name: "ChecklistId", type: "String(20)", note: "FK → HcmChecklist; the checklist template this task belongs to" },
      { name: "AssignmentType", type: "Enum", note: "Worker / Position / Group / Manager / Employee" },
      { name: "AssignedTo", type: "String(20)", note: "The specific worker/position/group ID; type depends on AssignmentType" },
      { name: "DueDateOffset", type: "Integer", note: "Days before (negative) or after (positive) start/termination date" },
      { name: "Optional", type: "Enum", note: "Yes = informational only; No = required" },
      { name: "TaskLinkType", type: "Enum", note: "URL / MenuItem / WorkerDetails — defines the completion link; nullable" },
    ],
  },

  HcmChecklist: {
    name: "HcmChecklist",
    description: "Onboarding, offboarding, or transition checklist template. Groups a set of tasks together. Assigned to a worker at hire, termination, or transfer time. Supports a default owner (for fallback task assignment) and a work calendar for due-date calculations.",
    module: "Human Resources – Task Management",
    docsUrl: "https://learn.microsoft.com/dynamics365/human-resources/hr-task-mgmt",
    fields: [
      { name: "ChecklistId", type: "String(20)", note: "PK; natural key for the checklist template" },
      { name: "Name", type: "String(100)", note: "Display name of the checklist" },
      { name: "ChecklistType", type: "Enum", note: "Onboarding / Offboarding / Transition" },
      { name: "Owner", type: "String(20)", note: "FK → HcmWorker.PersonnelNumber; default assignee when no other owner can be resolved" },
      { name: "CalendarId", type: "String(10)", note: "FK → WorkCalendar; used to calculate working-day due dates for tasks" },
      { name: "Description", type: "String(1000)", note: "Optional description of the checklist purpose; nullable" },
    ],
  },

  SecurityUserRole: {
    name: "SecurityUserRole",
    description: "Maps a D365FO system user to a security role. Controls which modules, menu items, and data the user can access via role-based security. Assignment can be manual or rule-driven (automatic). Protected by AOSAuthorization=CreateUpdateDelete to prevent privilege escalation.",
    module: "System Administration – Security",
    docsUrl: "https://learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/dev-ref/system-tables#securityuserrole",
    fields: [
      { name: "User", type: "String(UserId)", note: "FK → UserInfo; the system user being granted the role" },
      { name: "SecurityRole", type: "Int64", note: "FK → SecurityRole.RecId; the role being assigned" },
      { name: "AssignmentMode", type: "Enum", note: "Manual or Automatic (rule-driven)" },
      { name: "AssignmentStatus", type: "Enum", note: "Enabled or Disabled" },
      { name: "ValidFrom", type: "UtcDateTime", note: "Effective start of the assignment" },
      { name: "ValidTo", type: "UtcDateTime", note: "Effective end of the assignment; nullable" },
    ],
  },

  HcmCompPlan: {
    name: "HcmCompPlan",
    description: "Base compensation plan definition — the parent record that specifies plan ID, plan type (Fixed/Variable), currency, effective date range, and pay frequency. Fixed and variable compensation plans both reference this record. Eligibility rules are attached to control which workers can be enrolled.",
    module: "Human Resources – Compensation",
    docsUrl: "https://learn.microsoft.com/dynamics365/human-resources/hr-compensation-overview",
    fields: [
      { name: "Plan", type: "String(20)", note: "PK; natural key / plan ID (e.g. 'ANNUAL-FIXED')" },
      { name: "Description", type: "String(60)", note: "Human-readable plan description" },
      { name: "Type", type: "Enum", note: "Fixed / Variable / None — determines the subtype" },
      { name: "EffectiveDate", type: "Date", note: "Date the plan becomes active" },
      { name: "ExpirationDate", type: "Date", note: "Date the plan expires; nullable for open-ended plans" },
      { name: "Currency", type: "String(3)", note: "ISO currency code for all pay amounts in this plan" },
      { name: "PayFrequency", type: "String(10)", note: "FK → HcmPayRateConversion; pay frequency (Annual, Monthly, Hourly, etc.)" },
    ],
  },

  HcmCompFixedPlan: {
    name: "HcmCompFixedPlan",
    description: "Fixed compensation plan details — extends the base HcmCompPlan with a salary grid structure, hire rule, out-of-range tolerance, and control point. Workers are enrolled via the fixed compensation enrollment process tied to their position's compensation level.",
    module: "Human Resources – Compensation",
    docsUrl: "https://learn.microsoft.com/dynamics365/human-resources/hcm-comp-fixed-plan",
    fields: [
      { name: "Plan", type: "String(20)", note: "PK / FK → HcmCompPlan; the parent plan this fixed plan belongs to" },
      { name: "CompensationStructure", type: "String(20)", note: "FK → HcmCompGrid; the salary grade/band/step matrix" },
      { name: "HireRule", type: "Enum", note: "Percent (prorate new hires) or None" },
      { name: "OutOfRangeTolerance", type: "Enum", note: "None / Soft (warn) / Hard (error) for out-of-range pay" },
      { name: "RecommendationAllowed", type: "Enum", note: "Yes = process events allow guideline overrides" },
      { name: "ControlPoint", type: "String(20)", note: "FK → HcmCompRefPointSetupLine; ideal pay reference point (e.g. midpoint)" },
      { name: "RefPointSetupId", type: "String(20)", note: "FK → HcmCompRefPointSetup; reference point configuration for this plan" },
    ],
  },

  HcmBenefitPlan: {
    name: "HcmBenefitPlan",
    description: "Benefit plan definition — covers health, dental, vision, life, retirement, and other benefit types. Specifies the benefit type, vendor, coverage options, eligibility rules, premium currency, and effective dates. Workers are enrolled in plans via HcmBenefit.",
    module: "Human Resources – Benefits Management",
    docsUrl: "https://learn.microsoft.com/dynamics365/human-resources/hr-benefits-plans-setup",
    fields: [
      { name: "PlanId", type: "String(20)", note: "PK; natural key for the benefit plan (e.g. 'HEALTH-PPO')" },
      { name: "Description", type: "String(60)", note: "Plan display name" },
      { name: "PlanTypeId", type: "String(20)", note: "FK → HcmBenefitType; type (Medical, Dental, Vision, 401k, etc.)" },
      { name: "StartDate", type: "Date", note: "Plan effective start date" },
      { name: "EndDate", type: "Date", note: "Plan effective end date; nullable for ongoing plans" },
      { name: "VendorAccountNum", type: "String(20)", note: "FK → VendTable; the benefit insurance/plan provider vendor" },
      { name: "Currency", type: "String(3)", note: "ISO currency code for premium calculations" },
    ],
  },

  HcmBenefit: {
    name: "HcmBenefit",
    description: "Worker's enrollment in a specific benefit plan for a given period. Records the selected coverage option, employee/employer cost amounts, enrollment status (Selected/Confirmed/Waived), and effective dates. Created during open enrollment or life events.",
    module: "Human Resources – Benefits Management",
    docsUrl: "https://learn.microsoft.com/dynamics365/human-resources/hr-benefits-plans-worker",
    fields: [
      { name: "Worker", type: "Int64", note: "FK → HcmWorker.RecId; the enrolled worker" },
      { name: "PlanId", type: "String(20)", note: "FK → HcmBenefitPlan; the benefit plan the worker is enrolled in" },
      { name: "CoverageOptionId", type: "String(20)", note: "FK → HcmBenefitOption; coverage tier (Employee Only, Employee+Spouse, etc.)" },
      { name: "StartDate", type: "Date", note: "Enrollment effective start date" },
      { name: "EndDate", type: "Date", note: "Enrollment end date; nullable for open-ended enrollments" },
      { name: "Status", type: "Enum", note: "Selected / Confirmed / Waived / Cancelled" },
      { name: "LegalEntityId", type: "String(4)", note: "FK → CompanyInfo; the employing legal entity" },
    ],
  },

  HcmEligibilityRule: {
    name: "HcmEligibilityRule",
    description: "Benefit eligibility rule — defines the criteria a worker must meet to be eligible for a specific benefit plan (e.g. employment type = full-time, length of service ≥ 90 days, job title match). Rules are evaluated during open enrollment to filter available plans per worker.",
    module: "Human Resources – Benefits Management",
    docsUrl: "https://learn.microsoft.com/dynamics365/human-resources/hr-benefits-define-eligibility-rules",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "RuleId", type: "String", note: "Natural key — eligibility rule identifier" },
      { name: "Description", type: "String", note: "Human-readable description of what this rule tests" },
      { name: "RuleType", type: "Enum", note: "Type of condition: EmploymentType, JobTitle, Department, LengthOfService, etc." },
      { name: "EffectiveDate", type: "Date", note: "Date from which this rule is active" },
      { name: "ExpirationDate", type: "Date", note: "Date after which this rule is no longer evaluated; nullable for open-ended rules" },
    ],
  },

  HcmLeaveType: {
    name: "HcmLeaveType",
    description: "Leave type definition (e.g. Vacation/PTO, Sick Leave, FMLA, Parental Leave). Configures the category (Scheduled/Unscheduled), unit (Hours/Days), accrual earning code, approval workflow, reason code requirements, and calendar color.",
    module: "Human Resources – Leave and Absence",
    docsUrl: "https://learn.microsoft.com/dynamics365/human-resources/hr-admin-integration-payroll-api-leave-type",
    fields: [
      { name: "LeaveTypeId", type: "String(20)", note: "PK; natural key (e.g. 'PTO', 'SICK', 'FMLA')" },
      { name: "Description", type: "String(60)", note: "Human-readable description" },
      { name: "Category", type: "Enum", note: "None / Scheduled / Unscheduled — affects absence management reporting" },
      { name: "ReasonCodeRequired", type: "Enum", note: "Yes = worker must supply a reason code when submitting requests" },
      { name: "LeaveAmountUnit", type: "Enum", note: "Hours or Days — unit used when entering leave amounts" },
      { name: "EarningCodeId", type: "String(10)", note: "FK → PayrollEarningCode; payroll earning code linked to this leave type; nullable" },
      { name: "WorkflowId", type: "String(20)", note: "FK → workflow definition; approval workflow for leave requests; nullable" },
    ],
  },

  HcmLeaveAccrualSchedule: {
    name: "HcmLeaveAccrualSchedule",
    description: "Leave accrual schedule — defines the rate and frequency at which a worker earns (accrues) leave balance for a given leave type. Specifies accrual amount per period, accrual frequency (monthly, bi-weekly), carry-forward limits, and waiting period before accrual begins.",
    module: "Human Resources – Leave and Absence",
    docsUrl: "https://learn.microsoft.com/dynamics365/human-resources/hr-leave-and-absence-accrue",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "LeaveAccrualScheduleId", type: "String", note: "Natural key — accrual schedule identifier" },
      { name: "Description", type: "String", note: "Human-readable description of the schedule" },
      { name: "LeaveTypeId", type: "String", fkTarget: "HcmLeaveType.LeaveTypeId", note: "FK to the leave type this schedule accrues for" },
      { name: "AccrualFrequency", type: "Enum", note: "Frequency of accrual: Monthly, SemiMonthly, BiWeekly, Weekly" },
      { name: "AccrualAmount", type: "Decimal", note: "Hours or days accrued per accrual period" },
      { name: "MaximumCarryForward", type: "Decimal", note: "Maximum balance that can be carried forward to the next accrual year; nullable for unlimited" },
      { name: "WaitingPeriod", type: "Int32", note: "Days a new employee must wait before accrual begins" },
    ],
  },

  HcmLeaveBank: {
    name: "HcmLeaveBank",
    description: "Leave bank — stores the current accrued leave balance per worker per leave type. Updated by accrual runs and leave request approvals. One row per worker–leave type combination; Balance holds the available hours/days.",
    module: "Human Resources – Leave and Absence",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/human-resources/hr-leave-and-absence-overview",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "Worker", type: "Int64", fkTarget: "HcmWorker.RecId", note: "FK to the worker whose leave balance is tracked" },
      { name: "LeaveTypeId", type: "String", fkTarget: "HcmLeaveType.LeaveTypeId", note: "FK to the leave type for this balance" },
      { name: "Balance", type: "Decimal", note: "Current available balance in the unit defined by the leave type (hours or days)" },
      { name: "TotalAccrued", type: "Decimal", note: "Total amount accrued in the current accrual year before any usage" },
      { name: "TotalUsed", type: "Decimal", note: "Total amount used (approved leave requests) in the current year" },
      { name: "CarryForwardBalance", type: "Decimal", note: "Balance carried forward from the previous accrual year" },
    ],
  },

  HcmLeaveRequest: {
    name: "HcmLeaveRequest",
    description: "Worker leave request record. Captures a single request for time off — leave type, date, quantity, status, and any attached reason code or comment. Follows a configurable approval workflow. Status progresses: Draft → Submitted → Approved/Denied.",
    module: "Human Resources – Leave and Absence",
    docsUrl: "https://learn.microsoft.com/dynamics365/human-resources/hr-admin-integration-payroll-api-leave-request",
    fields: [
      { name: "RequestId", type: "String(36)", note: "PK; system-generated unique request identifier" },
      { name: "PersonnelNumber", type: "String(20)", note: "FK (natural key) → HcmWorker; the requesting employee" },
      { name: "LeaveTypeId", type: "String(20)", note: "FK → HcmLeaveType; the type of leave being requested" },
      { name: "LeaveDate", type: "UtcDateTime", note: "The date(s) covered by this leave request" },
      { name: "Amount", type: "Decimal", note: "Quantity of leave in units defined by HcmLeaveType.LeaveAmountUnit" },
      { name: "Status", type: "Enum", note: "Draft / Submitted / Approved / Denied / Failed / Cancelled" },
      { name: "ReasonCodeId", type: "String(20)", note: "FK → HcmReasonCode; reason for leave; required when LeaveType.ReasonCodeRequired=Yes" },
      { name: "Comment", type: "String(2000)", note: "Free-text comment from worker; nullable" },
    ],
  },

  HcmSeparation: {
    name: "HcmSeparation",
    description: "Worker termination / separation record. Formally ends employment by recording the termination date, reason code, last date worked, and re-hire eligibility. Initiates the offboarding process: ends position assignments, benefit elections, compensation, and leave accruals.",
    module: "Human Resources",
    docsUrl: "https://learn.microsoft.com/dynamics365/guidance/business-processes/hire-to-retire-onboard-terminate-employment",
    fields: [
      { name: "Worker", type: "Int64", note: "FK → HcmWorker.RecId; the worker being terminated" },
      { name: "Employment", type: "Int64", note: "FK → HcmEmployment.RecId; the specific employment period being ended" },
      { name: "SeparationDate", type: "Date", note: "Official termination / separation effective date" },
      { name: "LastDateWorked", type: "Date", note: "Last actual day the worker performed work; may differ from SeparationDate; nullable" },
      { name: "ReasonCode", type: "String(10)", note: "FK → HcmReasonCode; termination reason (Resignation, Layoff, Retirement, etc.)" },
      { name: "DataAreaId", type: "String(4)", note: "Legal entity where the employment is being terminated" },
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

  ProjQuotationTable: {
    name: "ProjQuotationTable",
    description: "Project quotation header — a sales quotation issued for project-based work. Captures the customer, estimated revenue, probability of winning, and links to the billing contract (ProjInvoiceId). When won, the quotation is confirmed into a project contract and project. Equivalent to a project-type SalesQuotationTable.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/dynamics365/finance/project-management/project-quotations",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "QuotationId", type: "String", note: "Natural key — unique quotation identifier" },
      { name: "CustAccount", type: "String", fkTarget: "CustTable.AccountNum", note: "FK to the customer the quotation is issued to" },
      { name: "ProjInvoiceId", type: "String", fkTarget: "ProjContract.ProjInvoiceId", note: "FK to the billing contract this quotation is linked to; nullable before contract creation" },
      { name: "QuotationDate", type: "Date", note: "Date the quotation was created" },
      { name: "ExpiryDate", type: "Date", note: "Date after which the quotation expires" },
      { name: "Probability", type: "Decimal", note: "Probability of winning expressed as a percentage (0–100)" },
      { name: "Status", type: "Enum", note: "0=Created, 1=Sent, 2=Confirmed (won), 3=Lost, 4=Cancelled" },
      { name: "TotalAmount", type: "Decimal", note: "Estimated total contract value of the quotation" },
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
      { name: "ContractId", type: "string", note: "FK → ProjInvoiceTable.ProjInvoiceId (the billing contract)" },
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

  ProjWBSActivity: {
    name: "ProjWBSActivity",
    description: "Work breakdown structure activity — represents a task node in the project plan hierarchy. Stores scheduling, effort estimates, and resource assignments. Parent–child relationships form the WBS tree; estimate lines (ProjWBSActivityEstimatesEntity) attach hour/expense forecasts to each activity.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/entities/professionalservices/projectmanagementandaccounting/projwbsactivityestimatesentity",
    fields: [
      { name: "ActivityNumber", type: "string", note: "Natural key — unique activity/task identifier within the project" },
      { name: "ProjId", type: "string", note: "FK → ProjTable; the owning project" },
      { name: "Name", type: "string", note: "Activity name / task title" },
      { name: "ParentActivityNumber", type: "string", note: "FK → ProjWBSActivity.ActivityNumber (null = root node); defines tree hierarchy" },
      { name: "ScheduledStartDate", type: "date", note: "Planned start date of the activity" },
      { name: "ScheduledEndDate", type: "date", note: "Planned end date / completion date" },
      { name: "EstimatedEffort", type: "decimal", note: "Planned effort in hours for this task node" },
    ],
  },

  ProjWBSLineProperty: {
    name: "ProjWBSLineProperty",
    description: "WBS line property — configuration master that controls how a WBS activity's transactions are recognised for cost and revenue. Specifies chargeable/non-chargeable status, billing rule, and whether hours/expenses posted against this line property accrue to WIP or flow directly to P&L.",
    module: "Project Management and Accounting",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/project-operations/project-accounting/configure-project-categories",
    fields: [
      { name: "RecId", type: "Int64", note: "Surrogate primary key" },
      { name: "LinePropertyId", type: "String", note: "Natural key — line property identifier (e.g. 'Chargeable', 'Non-chargeable', 'Complementary')" },
      { name: "Description", type: "String", note: "Human-readable description of the line property" },
      { name: "LinePropertyType", type: "Enum", note: "0=Chargeable, 1=NonChargeable, 2=Complementary, 3=NotAvailable — controls billing and WIP treatment" },
      { name: "IncludeInInvoice", type: "Enum", note: "Whether transactions with this line property appear on the project invoice" },
      { name: "AccrueRevenue", type: "Enum", note: "Whether revenue is accrued to WIP for this line property type" },
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
      { name: "VoucherJournal", type: "string", note: "GL voucher number; links to LedgerTrans for the accounting entries" },
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
      { name: "VoucherJournal", type: "string", note: "GL voucher number linking to LedgerTrans" },
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
    docsUrl: "https://learn.microsoft.com/en-us/common-data-model/schema/core/operationscommon/tables/professionalservices/projectmanagementandaccounting/transaction/projinvoicejour",
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
      { name: "ActivityNumber", type: "string", note: "FK → ProjWBSActivity (optional); WBS task the milestone aligns to" },
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
      { name: "VoucherJournal", type: "string", note: "GL voucher; links to LedgerTrans for the WIP-Revenue accounting entry" },
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

}