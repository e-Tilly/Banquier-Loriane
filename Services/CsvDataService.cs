using System.Globalization;
using System.Net.Http;
using System.Threading.Tasks;
using BankerGameWeb.Models;

namespace BankerGameWeb.Services;

public class CsvDataService
{
    private readonly HttpClient _httpClient;

    public CsvDataService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<List<(Prize Prize, int EliminationOrder, string? SpecialGiftName)>> LoadGiftsAsync()
    {
        var result = new List<(Prize Prize, int EliminationOrder, string? SpecialGiftName)>();
        var csv = await _httpClient.GetStringAsync("liste_cadeau.csv");
        var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries);

        // Skip header
        for (int i = 1; i < lines.Length; i++)
        {
            var line = lines[i].Trim();
            if (string.IsNullOrWhiteSpace(line)) continue;

            var parts = ParseCsvLine(line);
            if (parts.Count >= 3)
            {
                var name = parts[0];
                if (decimal.TryParse(parts[1], NumberStyles.Any, CultureInfo.InvariantCulture, out var value))
                {
                    var eliminationOrderStr = parts[2];
                    string? specialGift = parts.Count > 3 ? parts[3] : null;

                    var prize = new Prize
                    {
                        Name = name,
                        Value = value
                    };

                    // Add all prizes - those without elimination order get a high number (1000+)
                    int eliminationOrder = 1000 + i; // Default for prizes without order
                    if (!string.IsNullOrWhiteSpace(eliminationOrderStr) && 
                        int.TryParse(eliminationOrderStr, out var parsedOrder))
                    {
                        eliminationOrder = parsedOrder;
                    }

                    result.Add((prize, eliminationOrder, specialGift));
                }
            }
        }

        return result.OrderBy(x => x.EliminationOrder).ToList();
    }

    public async Task<List<SpecialGift>> LoadSpecialGiftsAsync()
    {
        var result = new List<SpecialGift>();
        var csv = await _httpClient.GetStringAsync("liste_cadeau.csv");
        var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries);

        // Skip header
        for (int i = 1; i < lines.Length; i++)
        {
            var line = lines[i].Trim();
            if (string.IsNullOrWhiteSpace(line)) continue;

            var parts = ParseCsvLine(line);
            if (parts.Count >= 4)
            {
                var eliminationOrderStr = parts[2];
                var specialGiftName = parts[3];

                if (!string.IsNullOrWhiteSpace(specialGiftName) &&
                    !string.IsNullOrWhiteSpace(eliminationOrderStr) &&
                    int.TryParse(eliminationOrderStr, out var eliminationOrder))
                {
                    // Parse special gift name to extract value if it contains "de X$"
                    decimal specialValue = 0;
                    var match = System.Text.RegularExpressions.Regex.Match(specialGiftName, @"de (\d+)\$");
                    if (match.Success && decimal.TryParse(match.Groups[1].Value, out var val))
                    {
                        specialValue = val;
                    }

                    result.Add(new SpecialGift
                    {
                        Name = specialGiftName,
                        Value = specialValue,
                        TriggeredByEliminationOrder = eliminationOrder
                    });
                }
            }
        }

        return result;
    }

    public async Task<List<(BankerOffer Offer, int ToOpen, int OfferOrder)>> LoadBankerOffersAsync()
    {
        var result = new List<(BankerOffer Offer, int ToOpen, int OfferOrder)>();
        var csv = await _httpClient.GetStringAsync("offres.csv");
        var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries);

        // Skip header
        for (int i = 1; i < lines.Length; i++)
        {
            var line = lines[i].Trim();
            if (string.IsNullOrWhiteSpace(line)) continue;

            var parts = ParseCsvLine(line);
            if (parts.Count >= 4)
            {
                var offerName = parts[0];
                if (decimal.TryParse(parts[1], NumberStyles.Any, CultureInfo.InvariantCulture, out var value) &&
                    int.TryParse(parts[2], out var toOpen) &&
                    int.TryParse(parts[3], out var offerOrder))
                {
                    var offer = new BankerOffer
                    {
                        Amount = value,
                        Message = offerName
                    };

                    result.Add((offer, toOpen, offerOrder));
                }
            }
        }

        // Sort by offer order and calculate cumulative to_open values
        var sortedOffers = result.OrderBy(x => x.OfferOrder).ToList();
        var cumulativeOffers = new List<(BankerOffer Offer, int ToOpen, int OfferOrder)>();
        int cumulativeTotal = 0;
        
        foreach (var offer in sortedOffers)
        {
            cumulativeTotal += offer.ToOpen;
            cumulativeOffers.Add((offer.Offer, cumulativeTotal, offer.OfferOrder));
        }
        
        return cumulativeOffers;
    }

    private List<string> ParseCsvLine(string line)
    {
        var result = new List<string>();
        var inQuotes = false;
        var currentField = "";

        for (int i = 0; i < line.Length; i++)
        {
            var c = line[i];

            if (c == '"')
            {
                if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                {
                    // Double quote - add one quote to field
                    currentField += '"';
                    i++; // Skip next quote
                }
                else
                {
                    // Toggle quote mode
                    inQuotes = !inQuotes;
                }
            }
            else if (c == ',' && !inQuotes)
            {
                // End of field
                result.Add(currentField);
                currentField = "";
            }
            else
            {
                currentField += c;
            }
        }

        // Add last field
        result.Add(currentField);

        return result;
    }
}
