import python from 'bun_python';

export class TransactionIdGenerator {
  private readonly initialHtmlContent!: string;
  private client_transaction: any;

  private BeautifulSoup: any;
  private ClientTransaction: any;

  constructor(initialHtmlContent: string) {
    this.initialHtmlContent = initialHtmlContent;
  }

  public async getTransactionId(method: string, path: string): Promise<string> {
    if (!this.BeautifulSoup || !this.ClientTransaction) {
      this.BeautifulSoup = await python.import('bs4').BeautifulSoup;
      this.ClientTransaction = await python.import('x_client_transaction')
        .ClientTransaction;
    }

    if (!this.client_transaction) {
      const soup = this.BeautifulSoup(this.initialHtmlContent, 'lxml');
      this.client_transaction = this.ClientTransaction(soup);
    }

    const transaction_id = this.client_transaction.generate_transaction_id(
      method,
      path,
    );
    return transaction_id;
  }
}
