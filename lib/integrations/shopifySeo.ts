/** Admin GraphQL documents for a product's SEO title/description (shared by the products API and the catalog executor). */
export const SEO_QUERY = `query KxProductSeo($id: ID!) { product(id: $id) { id seo { title description } } }`;

export const SEO_UPDATE_MUTATION = `mutation KxProductSeoUpdate($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id seo { title description } }
    userErrors { field message }
  }
}`;
