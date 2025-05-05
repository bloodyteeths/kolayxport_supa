describe('Sync & Label Flow', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('syncs orders and displays rows', () => {
    cy.contains('Sync Orders').click();
    // Wait for the rows to appear
    cy.get('table tbody tr').should('have.length.greaterThan', 0);
  });

  it('generates a label for the first order', () => {
    // Ensure at least one row exists
    cy.get('table tbody tr').first().as('firstRow');
    cy.get('@firstRow').find('button').contains('Generate Label').click();
    // The View Label link should appear
    cy.get('@firstRow').find('a').contains('View Label').should('be.visible');
  });
}); 