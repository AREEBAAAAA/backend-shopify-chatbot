import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json());
app.options("*", cors());

/* =====================
   FETCH SHOPIFY PRODUCTS
===================== */
async function getProducts() {
  try {
    const query = `
    {
      products(first: 20) {
        edges {
          node {
            title
            description
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
          "X-Shopify-Storefront-Access-Token": process.env.SHOPIFY_TOKEN,
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

/* =====================
   HEALTH CHECK
===================== */
app.get("/", (req, res) => {
  res.json({ status: "Backend is running" });
});

/* =====================
   CHAT ROUTE
===================== */
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.json({
        reply: "Please enter a message.",
        products: [],
      });
    }

    // Get store products
    const products = await getProducts();

    // Convert products into AI-readable format
    const productText = products
      .map((p) => {
        return `
Product: ${p.title}
Description: ${p.description || "No description"}
Price: ${p.variants.edges[0]?.node?.price?.amount || "N/A"}
Link: /products/${p.handle}
`;
      })
      .join("\n---\n");

    // Call Groq AI
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
              content: `
You are a Shopify AI shopping assistant.

Rules:
- Use ONLY the provided store products
- Recommend best matching products
- Be short and clear
- If nothing matches, say "No suitable product found"
              `,
            },
            {
              role: "user",
              content: `
Customer message: ${message}

Store Products:
${productText}
              `,
            },
          ],
          temperature: 0.7,
        }),
      }
    );

    const aiData = await groqResponse.json();

    if (!groqResponse.ok) {
      console.log("Groq Error:", aiData);

      return res.json({
        reply: "AI service error. Please check API key.",
        products: [],
      });
    }

    const reply =
      aiData?.choices?.[0]?.message?.content ||
      "Sorry, I couldn't generate a response.";

    return res.json({
      reply,
      products,
    });

  } catch (error) {
    console.error("CHAT ERROR:", error);

    return res.json({
      reply: "Server error. Please try again.",
      products: [],
    });
  }
});

/* =====================
   EXPORT FOR VERCEL
===================== */
export default app;