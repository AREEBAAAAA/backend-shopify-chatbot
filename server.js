import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// =====================
// FETCH SHOPIFY PRODUCTS
// =====================
async function getProducts() {
  try {
    const query = `
    {
      products(first: 10) {
        edges {
          node {
            title
            handle
            images(first: 1) {
              edges {
                node {
                  url
                }
              }
            }
            variants(first: 1) {
              edges {
                node {
                  id
                  price {
                    amount
                  }
                }
              }
            }
          }
        }
      }
    }`;

    const response = await fetch(
      `https://${process.env.SHOPIFY_STORE}/api/2024-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token":
            process.env.SHOPIFY_TOKEN,
        },
        body: JSON.stringify({ query }),
      }
    );

    const data = await response.json();

    if (!response.ok || data.errors) {
      console.log("Shopify Error:", data);
      return [];
    }

    return data.data.products.edges.map((p) => p.node);

  } catch (error) {
    console.error("Shopify Fetch Error:", error);
    return [];
  }
}

// =====================
// CHAT ROUTE
// =====================
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.json({
        reply: "Please enter a message.",
        products: [],
      });
    }

    // =====================
    // GET PRODUCTS
    // =====================
    const products = await getProducts();

    const matchedProducts = products.filter((p) =>
      p.title.toLowerCase().includes(message.toLowerCase())
    );

    let productText = "No matching products found.";

    if (matchedProducts.length > 0) {
      productText = matchedProducts
        .map(
          (p) =>
            `${p.title} - ${
              p.variants.edges[0]?.node?.price?.amount || "N/A"
            }`
        )
        .join("\n");
    }

    // =====================
    // GROQ API CALL
    // =====================
    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content:
                "You are a helpful Shopify AI assistant. Recommend products clearly and simply.",
            },
            {
              role: "user",
              content: `User message: ${message}\n\nProducts:\n${productText}`,
            },
          ],
          temperature: 0.7,
        }),
      }
    );

    const aiData = await groqResponse.json();

    // =====================
    // ERROR HANDLING (IMPORTANT FIX)
    // =====================
    if (!groqResponse.ok) {
      console.log("Groq Error:", aiData);

      return res.json({
        reply:
          "AI service error. Please check API key or try again later.",
        products: matchedProducts,
      });
    }

    const reply =
      aiData?.choices?.[0]?.message?.content ||
      "Sorry, I couldn't generate a response.";

    return res.json({
      reply,
      products: matchedProducts,
    });

  } catch (error) {
    console.error("CHAT ERROR:", error);

    return res.json({
      reply: "Server error. Please try again.",
      products: [],
    });
  }
});

// =====================
// START SERVER
// =====================
app.listen(3000, () => {
  console.log("Backend running on http://localhost:3000");
});